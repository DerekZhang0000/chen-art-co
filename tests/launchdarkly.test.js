const { test } = require("node:test");
const assert = require("node:assert/strict");

const fnPromise = import("../functions/_lib/launchdarkly.js");

function fakeContext() {
  return { waitUntil: () => {} };
}

test("isFlagOn: returns true when the flag evaluates to true", async () => {
  const { isFlagOn } = await fnPromise;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ "maintenance-mode": { value: true } }), { status: 200 });

  try {
    const result = await isFlagOn("client-side-id", "maintenance-mode", fakeContext());
    assert.equal(result, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("isFlagOn: returns false when the flag evaluates to false", async () => {
  const { isFlagOn } = await fnPromise;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ "maintenance-mode": { value: false } }), { status: 200 });

  try {
    const result = await isFlagOn("client-side-id", "maintenance-mode", fakeContext());
    assert.equal(result, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("isFlagOn: returns false when the flag key is missing from the response", async () => {
  const { isFlagOn } = await fnPromise;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 200 });

  try {
    const result = await isFlagOn("client-side-id", "maintenance-mode", fakeContext());
    assert.equal(result, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("isFlagOn: throws when LaunchDarkly returns an error status (caller decides how to fail)", async () => {
  const { isFlagOn } = await fnPromise;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 500 });

  try {
    await assert.rejects(() => isFlagOn("client-side-id", "maintenance-mode", fakeContext()));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("isFlagOn: requests the client-side ID and a base64url-encoded anonymous context", async () => {
  const { isFlagOn } = await fnPromise;
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = url;
    return new Response(JSON.stringify({ "maintenance-mode": { value: false } }), { status: 200 });
  };

  try {
    await isFlagOn("abc123", "maintenance-mode", fakeContext());
    assert.match(requestedUrl, /^https:\/\/clientsdk\.launchdarkly\.com\/sdk\/evalx\/abc123\/contexts\//);
    const encodedContext = requestedUrl.split("/contexts/")[1];
    assert.doesNotMatch(encodedContext, /[+/=]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
