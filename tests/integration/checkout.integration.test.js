// Local integration test - creates a REAL Stripe test-mode Checkout
// Session via the real STRIPE_SECRET_KEY in .dev.vars. Uses only
// preview-test-item (unlimited stock) so no real seeded inventory is
// touched. Does not complete the checkout (that needs a browser).
const { test } = require("node:test");
const assert = require("node:assert/strict");

const BASE_URL = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:8799";

test("POST /api/create-checkout-session creates a real Stripe test-mode Checkout Session", async () => {
  const res = await fetch(`${BASE_URL}/api/create-checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ id: "preview-test-item", qty: 1 }] }),
  });

  const body = await res.json();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
  assert.match(body.url, /^https:\/\/checkout\.stripe\.com\//, "expected a real Stripe Checkout URL");
});
