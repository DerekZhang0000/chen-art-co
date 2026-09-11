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

// Minimal fake of the Workers/Pages `caches.default` Cache API - just
// enough of `.match`/`.put` for isFlagOn's cache-hit and cache-write paths.
function fakeCache() {
  const store = new Map();
  return {
    async match(request) {
      return store.get(request.url) || undefined;
    },
    async put(request, response) {
      store.set(request.url, response);
    },
  };
}

test("isFlagOn: a cache hit returns the cached value without calling fetch", async () => {
  const { isFlagOn } = await fnPromise;
  const originalCaches = globalThis.caches;
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response(JSON.stringify({ "maintenance-mode": { value: false } }), { status: 200 });
  };
  const cache = fakeCache();
  globalThis.caches = { default: cache };

  try {
    // Prime the cache directly, the way a prior isFlagOn call would have.
    const cacheKey = new Request("https://ld-flag-cache.internal/client-side-id/maintenance-mode");
    await cache.put(cacheKey, new Response(JSON.stringify({ value: true })));

    const result = await isFlagOn("client-side-id", "maintenance-mode", fakeContext());
    assert.equal(result, true);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.caches = originalCaches;
    globalThis.fetch = originalFetch;
  }
});

test("isFlagOn: a fresh fetch is cached via context.waitUntil(cache.put(...))", async () => {
  const { isFlagOn } = await fnPromise;
  const originalCaches = globalThis.caches;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ "maintenance-mode": { value: true } }), { status: 200 });
  const cache = fakeCache();
  globalThis.caches = { default: cache };

  const waited = [];
  const context = { waitUntil: (p) => waited.push(p) };

  try {
    const result = await isFlagOn("client-side-id", "maintenance-mode", context);
    assert.equal(result, true);
    assert.equal(waited.length, 1);
    await waited[0];

    const cacheKey = new Request("https://ld-flag-cache.internal/client-side-id/maintenance-mode");
    const cached = await cache.match(cacheKey);
    assert.ok(cached);
    assert.deepEqual(await cached.json(), { value: true });
  } finally {
    globalThis.caches = originalCaches;
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
