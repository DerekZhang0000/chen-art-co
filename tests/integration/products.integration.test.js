// Local integration test - talks to a REAL `wrangler pages dev` server
// (started by scripts/run-integration-tests.js) and real local D1. No
// third-party calls, so this one is safe to re-run freely.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const BASE_URL = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:8799";

test("GET /api/products returns the real catalog merged with live local D1 stock", async () => {
  const res = await fetch(`${BASE_URL}/api/products`);
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);

  const products = await res.json();
  assert.ok(Array.isArray(products) && products.length > 0, "expected a non-empty product list");

  for (const product of products) {
    assert.equal(typeof product.stock, "number", `${product.id} should have a numeric stock`);
  }

  // SHOW_TEST_PRODUCTS=true in .dev.vars should reveal the unlimited-stock
  // preview item used by the other integration tests below.
  const previewItem = products.find((p) => p.id === "preview-test-item");
  assert.ok(previewItem, "preview-test-item should be visible when SHOW_TEST_PRODUCTS=true");
  assert.equal(previewItem.stock, -1);
});
