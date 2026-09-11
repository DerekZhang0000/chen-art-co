// Local integration test - hand-signs a checkout.session.completed payload
// with the real STRIPE_WEBHOOK_SECRET from .dev.vars (bypassing the Stripe
// CLI/`stripe listen`, which this suite doesn't depend on) and POSTs it to
// the real webhook endpoint. Uses only preview-test-item (unlimited stock)
// so no real seeded inventory is decremented, and a fresh random event/
// session id each run so the duplicate-event guard never suppresses the
// send. This DOES send real seller + buyer emails via Resend if
// RESEND_API_KEY/SELLER_EMAIL are set in .dev.vars.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const BASE_URL = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:8799";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

async function signPayload(rawBody, secret, timestamp) {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const buffer = await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

test("POST /api/stripe-webhook processes a hand-signed checkout.session.completed event end-to-end", async (t) => {
  if (!WEBHOOK_SECRET) {
    t.skip("STRIPE_WEBHOOK_SECRET not set in .dev.vars");
    return;
  }

  const eventId = `evt_integration_${crypto.randomUUID()}`;
  const sessionId = `cs_integration_${crypto.randomUUID()}`;

  const event = {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        amount_total: 50,
        amount_subtotal: 50,
        currency: "usd",
        customer_details: { email: "integration-test@example.com", name: "[Integration Test] Buyer" },
        metadata: {
          items: JSON.stringify([
            { id: "preview-test-item", qty: 1, name: "[Integration Test] Test Item", price: 50, image: "images/logo.png" },
          ]),
        },
      },
    },
  };

  const rawBody = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signPayload(rawBody, WEBHOOK_SECRET, timestamp);

  const res = await fetch(`${BASE_URL}/api/stripe-webhook`, {
    method: "POST",
    headers: { "Stripe-Signature": `t=${timestamp},v1=${signature}` },
    body: rawBody,
  });

  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${await res.text()}`);
});
