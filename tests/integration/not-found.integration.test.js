// Local integration test - confirms Cloudflare Pages' real 404 handling
// (via the project's own 404.html) for an unmatched route, rather than the
// default SPA-style fallback that would silently return 200 with the
// homepage. No third-party calls, safe to run repeatedly.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const BASE_URL = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:8799";

test("GET /some-bogus-path returns a real 404, not the homepage", async () => {
  const res = await fetch(`${BASE_URL}/some-bogus-path`);
  assert.equal(res.status, 404);

  const body = await res.text();
  assert.match(body, /page not found/i);
});
