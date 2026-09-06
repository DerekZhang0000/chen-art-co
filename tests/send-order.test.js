const { test } = require("node:test");
const assert = require("node:assert/strict");

// This file uses `export`, as Cloudflare Pages Functions require - loaded
// here via dynamic import() from a CommonJS test file (no config needed).
const fnPromise = import("../functions/api/send-order.js");

function fakeRequest(fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) form.set(key, value);
  }
  return new Request("https://chenart.co/api/send-order", { method: "POST", body: form });
}

const VALID_FIELDS = {
  name: "Ada",
  email: "ada@example.com",
  garment: "crewneck",
  idea: "a rocket ship",
  timeline: "next month",
  budget: "$50",
};

test("onRequestPost: missing RESEND_API_KEY returns 500 and never calls fetch", async () => {
  const { onRequestPost } = await fnPromise;
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalled = true; };

  try {
    const res = await onRequestPost({ request: fakeRequest(VALID_FIELDS), env: { SELLER_EMAIL: "seller@example.com" } });
    assert.equal(res.status, 500);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequestPost: missing SELLER_EMAIL returns 500 and never calls fetch", async () => {
  const { onRequestPost } = await fnPromise;
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalled = true; };

  try {
    const res = await onRequestPost({ request: fakeRequest(VALID_FIELDS), env: { RESEND_API_KEY: "re_x" } });
    assert.equal(res.status, 500);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequestPost: malformed form body returns 400", async () => {
  const { onRequestPost } = await fnPromise;
  const badRequest = new Request("https://chenart.co/api/send-order", {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=x" },
    body: "not a valid multipart body",
  });
  const res = await onRequestPost({
    request: badRequest,
    env: { RESEND_API_KEY: "re_x", SELLER_EMAIL: "seller@example.com" },
  });
  assert.equal(res.status, 400);
});

for (const missingField of ["name", "email", "garment", "idea"]) {
  test(`onRequestPost: missing required field "${missingField}" returns 400`, async () => {
    const { onRequestPost } = await fnPromise;
    const fields = { ...VALID_FIELDS, [missingField]: "" };
    const res = await onRequestPost({
      request: fakeRequest(fields),
      env: { RESEND_API_KEY: "re_x", SELLER_EMAIL: "seller@example.com" },
    });
    assert.equal(res.status, 400);
  });
}

test("onRequestPost: optional fields (timeline/budget) can be omitted", async () => {
  const { onRequestPost } = await fnPromise;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });

  try {
    const { timeline, budget, ...required } = VALID_FIELDS;
    const res = await onRequestPost({
      request: fakeRequest(required),
      env: { RESEND_API_KEY: "re_x", SELLER_EMAIL: "seller@example.com" },
    });
    assert.equal(res.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequestPost: happy path emails all comma-separated sellers with reply-to set to the buyer", async () => {
  const { onRequestPost } = await fnPromise;
  const originalFetch = globalThis.fetch;
  let resendCalledWith = null;

  globalThis.fetch = async (url, init) => {
    resendCalledWith = { url: String(url), init };
    return new Response("{}", { status: 200 });
  };

  try {
    const res = await onRequestPost({
      request: fakeRequest(VALID_FIELDS),
      env: { RESEND_API_KEY: "re_x", SELLER_EMAIL: "a@example.com, b@example.com" },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(resendCalledWith.url, "https://api.resend.com/emails");
    assert.equal(resendCalledWith.init.headers.Authorization, "Bearer re_x");

    const payload = JSON.parse(resendCalledWith.init.body);
    assert.deepEqual(payload.to, ["a@example.com", "b@example.com"]);
    assert.equal(payload.reply_to, VALID_FIELDS.email);
    assert.equal(payload.from, "onboarding@resend.dev");
    assert.match(payload.subject, /Ada/);
    assert.match(payload.text, /crewneck/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequestPost: uses FROM_EMAIL when configured instead of the default sender", async () => {
  const { onRequestPost } = await fnPromise;
  const originalFetch = globalThis.fetch;
  let resendCalledWith = null;

  globalThis.fetch = async (url, init) => {
    resendCalledWith = init;
    return new Response("{}", { status: 200 });
  };

  try {
    await onRequestPost({
      request: fakeRequest(VALID_FIELDS),
      env: { RESEND_API_KEY: "re_x", SELLER_EMAIL: "seller@example.com", FROM_EMAIL: "orders@chenart.co" },
    });
    const payload = JSON.parse(resendCalledWith.body);
    assert.equal(payload.from, "orders@chenart.co");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequestPost: Resend error response surfaces its message, or a fallback if absent", async () => {
  const { onRequestPost } = await fnPromise;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "Invalid API key" }), { status: 401 });

  try {
    const res = await onRequestPost({
      request: fakeRequest(VALID_FIELDS),
      env: { RESEND_API_KEY: "re_bad", SELLER_EMAIL: "seller@example.com" },
    });
    const body = await res.json();
    assert.equal(res.status, 502);
    assert.equal(body.error, "Invalid API key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequestPost: Resend error response with no message uses the fallback text", async () => {
  const { onRequestPost } = await fnPromise;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 500 });

  try {
    const res = await onRequestPost({
      request: fakeRequest(VALID_FIELDS),
      env: { RESEND_API_KEY: "re_bad", SELLER_EMAIL: "seller@example.com" },
    });
    const body = await res.json();
    assert.match(body.error, /Couldn't send the request/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
