const { test } = require("node:test");
const assert = require("node:assert/strict");

const fnPromise = import("../functions/_middleware.js");

function fakeAssets(html) {
  return { fetch: async () => new Response(html, { status: 200 }) };
}

function fakeContext(overrides = {}) {
  return {
    request: new Request("https://chenart.co/"),
    env: {},
    next: async () => new Response("real site"),
    waitUntil: () => {},
    ...overrides,
  };
}

test("onRequest: passes through when LD_CLIENT_SIDE_ID isn't configured", async () => {
  const { onRequest } = await fnPromise;
  const res = await onRequest(fakeContext());
  assert.equal(await res.text(), "real site");
});

test("onRequest: passes through when the flag evaluates to false", async () => {
  const { onRequest } = await fnPromise;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ "maintenance-mode": { value: false } }), { status: 200 });

  try {
    const res = await onRequest(fakeContext({ env: { LD_CLIENT_SIDE_ID: "abc" } }));
    assert.equal(await res.text(), "real site");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequest: serves maintenance.html with 503 when the flag evaluates to true", async () => {
  const { onRequest } = await fnPromise;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ "maintenance-mode": { value: true } }), { status: 200 });

  try {
    const res = await onRequest(
      fakeContext({
        env: { LD_CLIENT_SIDE_ID: "abc", ASSETS: fakeAssets("<html>down</html>") },
      })
    );
    assert.equal(res.status, 503);
    assert.equal(await res.text(), "<html>down</html>");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequest: always lets the logo through, even during maintenance, so the maintenance page itself isn't broken", async () => {
  const { onRequest } = await fnPromise;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("should not check the flag for the logo request");
  };

  try {
    const res = await onRequest(
      fakeContext({
        request: new Request("https://chenart.co/images/logo.png"),
        env: { LD_CLIENT_SIDE_ID: "abc" },
      })
    );
    assert.equal(await res.text(), "real site");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onRequest: fails open (passes through) when the LaunchDarkly check errors", async () => {
  const { onRequest } = await fnPromise;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 500 });

  try {
    const res = await onRequest(fakeContext({ env: { LD_CLIENT_SIDE_ID: "abc" } }));
    assert.equal(await res.text(), "real site");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
