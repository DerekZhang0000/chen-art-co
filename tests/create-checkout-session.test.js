const { test } = require("node:test");
const assert = require("node:assert/strict");

// This file uses `export`, as Cloudflare Pages Functions require - loaded
// here via dynamic import() from a CommonJS test file (no config needed).
const fnPromise = import("../functions/api/create-checkout-session.js");

const ORIGIN = "https://chenart.co";
const products = [
  { id: "a", name: "A", price: 1000, image: "images/a.jpg", stock: 1 },
  { id: "b", name: "B", price: 2500, image: "images/b.jpg", stock: 3 },
  { id: "c", name: "C", price: 500, image: "images/c.jpg", stock: 0 },
];

// ---------- buildLineItems ----------

test("buildLineItems: unknown id", async () => {
  const { buildLineItems } = await fnPromise;
  const result = buildLineItems([{ id: "nope", qty: 1 }], products, ORIGIN);
  assert.equal(result.status, 400);
  assert.match(result.error, /Unknown item/);
});

for (const badQty of [0, -1, "abc", undefined, null]) {
  test(`buildLineItems: invalid quantity (${JSON.stringify(badQty)})`, async () => {
    const { buildLineItems } = await fnPromise;
    const result = buildLineItems([{ id: "a", qty: badQty }], products, ORIGIN);
    assert.equal(result.status, 400);
    assert.match(result.error, /Invalid quantity/);
  });
}

test("buildLineItems: non-integer quantity truncates via Math.floor (conscious choice)", async () => {
  const { buildLineItems } = await fnPromise;
  const result = buildLineItems([{ id: "b", qty: "2.9" }], products, ORIGIN);
  assert.equal(result.lineItems[0].quantity, 2);
});

test("buildLineItems: sold out (stock 0)", async () => {
  const { buildLineItems } = await fnPromise;
  const result = buildLineItems([{ id: "c", qty: 1 }], products, ORIGIN);
  assert.equal(result.status, 409);
  assert.match(result.error, /sold out/);
});

test("buildLineItems: sold out when stock is missing entirely", async () => {
  const { buildLineItems } = await fnPromise;
  const noStock = [{ id: "x", name: "X", price: 100, image: "images/x.jpg" }];
  const result = buildLineItems([{ id: "x", qty: 1 }], noStock, ORIGIN);
  assert.equal(result.status, 409);
});

test("buildLineItems: quantity exactly at the stock boundary is allowed", async () => {
  const { buildLineItems } = await fnPromise;
  const result = buildLineItems([{ id: "b", qty: 3 }], products, ORIGIN);
  assert.equal(result.lineItems[0].quantity, 3);
});

test("buildLineItems: quantity one over stock is rejected with the product name", async () => {
  const { buildLineItems } = await fnPromise;
  const result = buildLineItems([{ id: "b", qty: 4 }], products, ORIGIN);
  assert.equal(result.status, 409);
  assert.match(result.error, /Only 3 left of "B"/);
});

test("buildLineItems: duplicate product id in one request is aggregated before the stock check (oversell fix)", async () => {
  const { buildLineItems } = await fnPromise;
  // Two separate qty:1 entries for a stock:1 item - each alone would pass,
  // but combined they exceed stock and must be rejected.
  const result = buildLineItems(
    [{ id: "a", qty: 1 }, { id: "a", qty: 1 }],
    products,
    ORIGIN
  );
  assert.equal(result.status, 409);
  assert.match(result.error, /Only 1 left of "A"/);
});

test("buildLineItems: aggregated duplicate quantities within stock are accepted as a single line item", async () => {
  const { buildLineItems } = await fnPromise;
  const result = buildLineItems(
    [{ id: "b", qty: 1 }, { id: "b", qty: 2 }],
    products,
    ORIGIN
  );
  assert.equal(result.lineItems.length, 1);
  assert.equal(result.lineItems[0].quantity, 3);
});

test("buildLineItems: correct Stripe line-item shape for multiple valid items", async () => {
  const { buildLineItems } = await fnPromise;
  const result = buildLineItems(
    [{ id: "a", qty: 1 }, { id: "b", qty: 2 }],
    products,
    ORIGIN
  );
  assert.deepEqual(result.lineItems, [
    {
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: 1000,
        product_data: { name: "A", images: ["https://chenart.co/images/a.jpg"] },
      },
    },
    {
      quantity: 2,
      price_data: {
        currency: "usd",
        unit_amount: 2500,
        product_data: { name: "B", images: ["https://chenart.co/images/b.jpg"] },
      },
    },
  ]);
});

// ---------- toFormBody ----------

test("toFormBody: flattens nested objects/arrays into Stripe's bracket notation", async () => {
  const { toFormBody } = await fnPromise;
  const body = toFormBody({
    mode: "payment",
    line_items: [{ quantity: 2, price_data: { currency: "usd" } }],
  });
  assert.equal(
    body,
    "mode=payment&line_items%5B0%5D%5Bquantity%5D=2&line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=usd"
  );
});

test("toFormBody: encodes special characters in values", async () => {
  const { toFormBody } = await fnPromise;
  const body = toFormBody({ name: "A & B / C" });
  assert.equal(body, "name=A%20%26%20B%20%2F%20C");
});

// ---------- onRequestPost (integration, fetch stubbed) ----------

function fakeRequest(payload) {
  return new Request("https://chenart.co/api/create-checkout-session", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

test("onRequestPost: missing STRIPE_SECRET_KEY returns 500 and never calls fetch", async () => {
  const { onRequestPost } = await fnPromise;
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalled = true; };

  try {
    const res = await onRequestPost({ request: fakeRequest({ items: [] }), env: {} });
    assert.equal(res.status, 500);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequestPost: empty items returns 400", async () => {
  const { onRequestPost } = await fnPromise;
  const res = await onRequestPost({
    request: fakeRequest({ items: [] }),
    env: { STRIPE_SECRET_KEY: "sk_test_x" },
  });
  assert.equal(res.status, 400);
});

test("onRequestPost: malformed request body returns 400", async () => {
  const { onRequestPost } = await fnPromise;
  const badRequest = new Request("https://chenart.co/api/create-checkout-session", {
    method: "POST",
    body: "not json",
  });
  const res = await onRequestPost({ request: badRequest, env: { STRIPE_SECRET_KEY: "sk_test_x" } });
  assert.equal(res.status, 400);
});

test("onRequestPost: products catalog fetch failing returns 500", async () => {
  const { onRequestPost } = await fnPromise;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 500 });

  try {
    const res = await onRequestPost({
      request: fakeRequest({ items: [{ id: "a", qty: 1 }] }),
      env: { STRIPE_SECRET_KEY: "sk_test_x" },
    });
    assert.equal(res.status, 500);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequestPost: happy path returns 200 with the Stripe session URL", async () => {
  const { onRequestPost } = await fnPromise;
  const originalFetch = globalThis.fetch;
  let stripeCalledWith = null;

  globalThis.fetch = async (url, init) => {
    if (String(url).includes("products.json")) {
      return new Response(JSON.stringify(products), { status: 200 });
    }
    if (String(url).includes("api.stripe.com")) {
      stripeCalledWith = init;
      return new Response(JSON.stringify({ url: "https://checkout.stripe.com/session/xyz" }), { status: 200 });
    }
    throw new Error("unexpected fetch: " + url);
  };

  try {
    const res = await onRequestPost({
      request: fakeRequest({ items: [{ id: "a", qty: 1 }] }),
      env: { STRIPE_SECRET_KEY: "sk_test_x" },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.url, "https://checkout.stripe.com/session/xyz");
    assert.equal(stripeCalledWith.headers.Authorization, "Bearer sk_test_x");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequestPost: Stripe error response surfaces its message, or a fallback if absent", async () => {
  const { onRequestPost } = await fnPromise;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    if (String(url).includes("products.json")) {
      return new Response(JSON.stringify(products), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 });
  };

  try {
    const res = await onRequestPost({
      request: fakeRequest({ items: [{ id: "a", qty: 1 }] }),
      env: { STRIPE_SECRET_KEY: "sk_bad" },
    });
    const body = await res.json();
    assert.equal(res.status, 502);
    assert.equal(body.error, "Invalid API key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequestPost: Stripe error response with no message uses the fallback text", async () => {
  const { onRequestPost } = await fnPromise;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    if (String(url).includes("products.json")) {
      return new Response(JSON.stringify(products), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 500 });
  };

  try {
    const res = await onRequestPost({
      request: fakeRequest({ items: [{ id: "a", qty: 1 }] }),
      env: { STRIPE_SECRET_KEY: "sk_bad" },
    });
    const body = await res.json();
    assert.equal(body.error, "Stripe couldn't create a checkout session.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
