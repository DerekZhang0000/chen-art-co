// Local integration test - sends a REAL email via Resend to the real
// SELLER_EMAIL in .dev.vars. The subject/name are prefixed so it's
// identifiable in the seller's inbox as an automated test, not a real lead.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const BASE_URL = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:8799";

test("POST /api/send-order sends a real custom-order email via Resend", async () => {
  const form = new FormData();
  form.set("name", "[Integration Test] Automated Suite");
  form.set("email", "integration-test@example.com");
  form.set("garment", "Integration test garment");
  form.set("idea", "This was sent by the automated local integration suite - safe to ignore/delete.");

  const res = await fetch(`${BASE_URL}/api/send-order`, { method: "POST", body: form });
  const body = await res.json();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(body.ok, true);
});
