const { test } = require("node:test");
const assert = require("node:assert/strict");

const fnPromise = import("../functions/api/stripe-webhook.js");

const SECRET = "whsec_test_secret";

async function signPayload(rawBody, secret, timestamp) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const buffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signedHeader(rawBody, secret, { timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const sig = await signPayload(rawBody, secret, timestamp);
  return `t=${timestamp},v1=${sig}`;
}

function fakeRequest(rawBody, signatureHeader) {
  const headers = signatureHeader ? { "Stripe-Signature": signatureHeader } : {};
  return new Request("https://chenart.co/api/stripe-webhook", { method: "POST", headers, body: rawBody });
}

// Hand-rolled D1 stub: prepare().bind() just records {sql, args}; batch()
// interprets those statements the way the webhook's two statement shapes
// require - a unique-constraint-violating insert throws (mirroring how
// Stripe's at-least-once redelivery of an already-processed event.id would
// behave against the real schema), and stock updates respect the same
// `stock >= qty` guard as the real SQL.
function fakeDb({ processedEventIds = new Set(), stockById = {} } = {}) {
  return {
    stockById,
    prepare(sql) {
      return { bind: (...args) => ({ sql, args }) };
    },
    async batch(stmts) {
      const results = [];
      for (const stmt of stmts) {
        if (/INSERT INTO processed_webhook_events/i.test(stmt.sql)) {
          const [eventId] = stmt.args;
          if (processedEventIds.has(eventId)) {
            throw new Error("UNIQUE constraint failed: processed_webhook_events.event_id");
          }
          processedEventIds.add(eventId);
          results.push({ meta: { changes: 1 } });
        } else if (/UPDATE product_stock/i.test(stmt.sql)) {
          const [qty, id] = stmt.args;
          if ((stockById[id] || 0) >= qty) {
            stockById[id] -= qty;
            results.push({ meta: { changes: 1 } });
          } else {
            results.push({ meta: { changes: 0 } });
          }
        } else {
          throw new Error("unexpected statement: " + stmt.sql);
        }
      }
      return results;
    },
  };
}

function checkoutCompletedEvent({
  id = "evt_1",
  sessionId = "cs_1",
  items,
  paymentStatus = "paid",
  customerDetails,
  shippingDetails,
  amountTotal,
  currency,
}) {
  return JSON.stringify({
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: paymentStatus,
        metadata: { items: JSON.stringify(items) },
        customer_details: customerDetails,
        shipping_details: shippingDetails,
        amount_total: amountTotal,
        currency,
      },
    },
  });
}

function asyncPaymentSucceededEvent({ id = "evt_1", sessionId = "cs_1", items }) {
  return JSON.stringify({
    id,
    type: "checkout.session.async_payment_succeeded",
    data: { object: { id: sessionId, payment_status: "paid", metadata: { items: JSON.stringify(items) } } },
  });
}

// ---------- verifyStripeSignature ----------

test("verifyStripeSignature: valid signature is accepted", async () => {
  const { verifyStripeSignature } = await fnPromise;
  const body = '{"hello":"world"}';
  const header = await signedHeader(body, SECRET);
  assert.equal(await verifyStripeSignature(body, header, SECRET), true);
});

test("verifyStripeSignature: a tampered body is rejected", async () => {
  const { verifyStripeSignature } = await fnPromise;
  const header = await signedHeader('{"hello":"world"}', SECRET);
  assert.equal(await verifyStripeSignature('{"hello":"tampered"}', header, SECRET), false);
});

test("verifyStripeSignature: the wrong secret is rejected", async () => {
  const { verifyStripeSignature } = await fnPromise;
  const body = '{"hello":"world"}';
  const header = await signedHeader(body, SECRET);
  assert.equal(await verifyStripeSignature(body, header, "whsec_wrong"), false);
});

test("verifyStripeSignature: a malformed header is rejected", async () => {
  const { verifyStripeSignature } = await fnPromise;
  assert.equal(await verifyStripeSignature("{}", "not-a-valid-header", SECRET), false);
});

test("verifyStripeSignature: a stale timestamp is rejected", async () => {
  const { verifyStripeSignature } = await fnPromise;
  const body = '{"hello":"world"}';
  const oldTimestamp = Math.floor(Date.now() / 1000) - 10000;
  const header = await signedHeader(body, SECRET, { timestamp: oldTimestamp });
  assert.equal(await verifyStripeSignature(body, header, SECRET), false);
});

// ---------- onRequestPost ----------

test("onRequestPost: missing STRIPE_WEBHOOK_SECRET returns 500", async () => {
  const { onRequestPost } = await fnPromise;
  const res = await onRequestPost({ request: fakeRequest("{}"), env: { DB: fakeDb() } });
  assert.equal(res.status, 500);
});

test("onRequestPost: missing DB binding returns 500", async () => {
  const { onRequestPost } = await fnPromise;
  const res = await onRequestPost({ request: fakeRequest("{}"), env: { STRIPE_WEBHOOK_SECRET: SECRET } });
  assert.equal(res.status, 500);
});

test("onRequestPost: invalid signature returns 400 and never touches the DB", async () => {
  const { onRequestPost } = await fnPromise;
  const db = fakeDb();
  db.batch = async () => { throw new Error("DB should not have been touched"); };
  const res = await onRequestPost({
    request: fakeRequest("{}", "t=123,v1=deadbeef"),
    env: { STRIPE_WEBHOOK_SECRET: SECRET, DB: db },
  });
  assert.equal(res.status, 400);
});

test("onRequestPost: an event type other than checkout.session.completed is a no-op 200", async () => {
  const { onRequestPost } = await fnPromise;
  const body = JSON.stringify({ id: "evt_1", type: "payment_intent.created" });
  const db = fakeDb();
  db.batch = async () => { throw new Error("DB should not have been touched"); };

  const res = await onRequestPost({
    request: fakeRequest(body, await signedHeader(body, SECRET)),
    env: { STRIPE_WEBHOOK_SECRET: SECRET, DB: db },
  });
  assert.equal(res.status, 200);
});

test("onRequestPost: happy path decrements stock by exactly the purchased quantities", async () => {
  const { onRequestPost } = await fnPromise;
  const body = checkoutCompletedEvent({ items: [{ id: "a", qty: 1 }, { id: "b", qty: 2 }] });
  const db = fakeDb({ stockById: { a: 1, b: 3 } });

  const res = await onRequestPost({
    request: fakeRequest(body, await signedHeader(body, SECRET)),
    env: { STRIPE_WEBHOOK_SECRET: SECRET, DB: db },
  });

  assert.equal(res.status, 200);
  assert.equal(db.stockById.a, 0);
  assert.equal(db.stockById.b, 1);
});

test("onRequestPost: a redelivered event (duplicate event.id) does not decrement stock again", async () => {
  const { onRequestPost } = await fnPromise;
  const body = checkoutCompletedEvent({ id: "evt_dup", items: [{ id: "a", qty: 1 }] });
  const db = fakeDb({ processedEventIds: new Set(["evt_dup"]), stockById: { a: 1 } });

  const res = await onRequestPost({
    request: fakeRequest(body, await signedHeader(body, SECRET)),
    env: { STRIPE_WEBHOOK_SECRET: SECRET, DB: db },
  });

  assert.equal(res.status, 200);
  assert.equal(db.stockById.a, 1); // unchanged - already processed once before
});

test("onRequestPost: a completed session with a delayed (unpaid) payment method does not decrement yet", async () => {
  const { onRequestPost } = await fnPromise;
  const body = checkoutCompletedEvent({ items: [{ id: "a", qty: 1 }], paymentStatus: "unpaid" });
  const db = fakeDb({ stockById: { a: 1 } });

  const res = await onRequestPost({
    request: fakeRequest(body, await signedHeader(body, SECRET)),
    env: { STRIPE_WEBHOOK_SECRET: SECRET, DB: db },
  });

  assert.equal(res.status, 200);
  assert.equal(db.stockById.a, 1); // untouched - waiting for async_payment_succeeded
});

test("onRequestPost: async_payment_succeeded decrements stock once the delayed payment actually clears", async () => {
  const { onRequestPost } = await fnPromise;
  const body = asyncPaymentSucceededEvent({ id: "evt_async_1", items: [{ id: "a", qty: 1 }] });
  const db = fakeDb({ stockById: { a: 1 } });

  const res = await onRequestPost({
    request: fakeRequest(body, await signedHeader(body, SECRET)),
    env: { STRIPE_WEBHOOK_SECRET: SECRET, DB: db },
  });

  assert.equal(res.status, 200);
  assert.equal(db.stockById.a, 0);
});

test("onRequestPost: an unlimited-stock product (preview-test-item) is never decremented and needs no D1 row", async () => {
  const { onRequestPost } = await fnPromise;
  const body = checkoutCompletedEvent({ items: [{ id: "preview-test-item", qty: 3 }] });
  const db = fakeDb(); // no product_stock row for preview-test-item at all

  const originalError = console.error;
  const logs = [];
  console.error = (msg) => logs.push(msg);

  try {
    const res = await onRequestPost({
      request: fakeRequest(body, await signedHeader(body, SECRET)),
      env: { STRIPE_WEBHOOK_SECRET: SECRET, DB: db },
    });
    assert.equal(res.status, 200);
    assert.equal(logs.length, 0); // no false "no effect" warning for an item that was never meant to decrement
  } finally {
    console.error = originalError;
  }
});

test("onRequestPost: a mixed order only decrements the tracked item, leaving the unlimited one alone", async () => {
  const { onRequestPost } = await fnPromise;
  const body = checkoutCompletedEvent({
    items: [{ id: "a", qty: 1 }, { id: "preview-test-item", qty: 5 }],
  });
  const db = fakeDb({ stockById: { a: 1 } });

  const res = await onRequestPost({
    request: fakeRequest(body, await signedHeader(body, SECRET)),
    env: { STRIPE_WEBHOOK_SECRET: SECRET, DB: db },
  });

  assert.equal(res.status, 200);
  assert.equal(db.stockById.a, 0);
  assert.equal(db.stockById["preview-test-item"], undefined);
});

test("onRequestPost: a decrement race (stock ran out) still returns 200 and logs a warning", async () => {
  const { onRequestPost } = await fnPromise;
  const body = checkoutCompletedEvent({ items: [{ id: "a", qty: 1 }] });
  const db = fakeDb({ stockById: { a: 0 } }); // already sold out by the time this webhook runs

  const originalError = console.error;
  const logs = [];
  console.error = (msg) => logs.push(msg);

  try {
    const res = await onRequestPost({
      request: fakeRequest(body, await signedHeader(body, SECRET)),
      env: { STRIPE_WEBHOOK_SECRET: SECRET, DB: db },
    });
    assert.equal(res.status, 200);
    assert.ok(logs.some((l) => /no effect/i.test(l)));
  } finally {
    console.error = originalError;
  }
});

// ---------- order notification email ----------

const RESEND_ENV = { STRIPE_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: "re_x", SELLER_EMAIL: "seller@example.com" };

test("onRequestPost: without RESEND_API_KEY/SELLER_EMAIL configured, no email is attempted", async () => {
  const { onRequestPost } = await fnPromise;
  const body = checkoutCompletedEvent({ items: [{ id: "a", qty: 1, name: "A", price: 1000 }] });
  const db = fakeDb({ stockById: { a: 1 } });
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalled = true; return new Response("{}", { status: 200 }); };

  try {
    const res = await onRequestPost({
      request: fakeRequest(body, await signedHeader(body, SECRET)),
      env: { STRIPE_WEBHOOK_SECRET: SECRET, DB: db },
    });
    assert.equal(res.status, 200);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequestPost: a paid order emails the seller with items, quantities, buyer, and shipping address", async () => {
  const { onRequestPost } = await fnPromise;
  const body = checkoutCompletedEvent({
    items: [{ id: "a", qty: 2, name: "A", price: 1000 }, { id: "b", qty: 1, name: "B", price: 2500 }],
    customerDetails: { email: "buyer@example.com", name: "Ada Lovelace" },
    shippingDetails: {
      name: "Ada Lovelace",
      address: { line1: "123 Main St", line2: "Apt 4", city: "Springfield", state: "IL", postal_code: "62704", country: "US" },
    },
    amountTotal: 4500,
    currency: "usd",
  });
  const db = fakeDb({ stockById: { a: 2, b: 1 } });

  let resendCalledWith = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    resendCalledWith = { url: String(url), init };
    return new Response("{}", { status: 200 });
  };

  try {
    const res = await onRequestPost({
      request: fakeRequest(body, await signedHeader(body, SECRET)),
      env: { ...RESEND_ENV, DB: db },
    });
    assert.equal(res.status, 200);
    assert.equal(resendCalledWith.url, "https://api.resend.com/emails");

    const payload = JSON.parse(resendCalledWith.init.body);
    assert.deepEqual(payload.to, ["seller@example.com"]);
    assert.match(payload.subject, /Ada Lovelace/);
    assert.match(payload.text, /2 x A \(\$10\.00 each\)/);
    assert.match(payload.text, /1 x B \(\$25\.00 each\)/);
    assert.match(payload.text, /buyer@example\.com/);
    assert.match(payload.text, /123 Main St/);
    assert.match(payload.text, /Springfield, IL 62704/);
    assert.match(payload.text, /\$45\.00 USD/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequestPost: a redelivered (duplicate) event does not send a second notification email", async () => {
  const { onRequestPost } = await fnPromise;
  const body = checkoutCompletedEvent({ id: "evt_dup", items: [{ id: "a", qty: 1, name: "A", price: 1000 }] });
  const db = fakeDb({ processedEventIds: new Set(["evt_dup"]), stockById: { a: 1 } });

  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalled = true; return new Response("{}", { status: 200 }); };

  try {
    const res = await onRequestPost({
      request: fakeRequest(body, await signedHeader(body, SECRET)),
      env: { ...RESEND_ENV, DB: db },
    });
    assert.equal(res.status, 200);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequestPost: a Resend failure is logged but still returns 200 (doesn't undo the stock decrement)", async () => {
  const { onRequestPost } = await fnPromise;
  const body = checkoutCompletedEvent({ items: [{ id: "a", qty: 1, name: "A", price: 1000 }] });
  const db = fakeDb({ stockById: { a: 1 } });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "Invalid API key" }), { status: 401 });

  const originalError = console.error;
  const logs = [];
  console.error = (msg) => logs.push(msg);

  try {
    const res = await onRequestPost({
      request: fakeRequest(body, await signedHeader(body, SECRET)),
      env: { ...RESEND_ENV, DB: db },
    });
    assert.equal(res.status, 200);
    assert.equal(db.stockById.a, 0); // stock decrement still happened
    assert.ok(logs.some((l) => /notification email failed/i.test(l)));
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("onRequestPost: missing shipping/customer details on the session render as fallback text, not a crash", async () => {
  const { onRequestPost } = await fnPromise;
  const body = checkoutCompletedEvent({ items: [{ id: "a", qty: 1, name: "A", price: 1000 }] }); // no customerDetails/shippingDetails
  const db = fakeDb({ stockById: { a: 1 } });

  let resendCalledWith = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    resendCalledWith = init;
    return new Response("{}", { status: 200 });
  };

  try {
    const res = await onRequestPost({
      request: fakeRequest(body, await signedHeader(body, SECRET)),
      env: { ...RESEND_ENV, DB: db },
    });
    assert.equal(res.status, 200);
    const payload = JSON.parse(resendCalledWith.body);
    assert.match(payload.text, /\(not provided\)/);
    assert.match(payload.text, /no shipping address on file/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
