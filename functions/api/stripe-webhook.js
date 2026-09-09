// Cloudflare Pages Function: POST /api/stripe-webhook
//
// Listens for Stripe's checkout events and decrements live stock in D1 for
// whatever was purchased, read from the session's `metadata.items` (set in
// create-checkout-session.js). This is the authoritative point where stock
// actually decreases - not the buyer's redirect back to the site, which
// they could skip by closing the tab.
//
// Two event types are handled, because `checkout.session.completed` does
// NOT always mean payment has actually cleared - delayed payment methods
// (e.g. bank debits) complete the *session* immediately with
// `payment_status: "unpaid"`, and the real confirmation arrives later as a
// separate `checkout.session.async_payment_succeeded` event on the same
// session. Decrementing stock on the initial "unpaid" completion would risk
// giving away a one-of-a-kind item for a payment that could still fail.
//   - checkout.session.completed        -> decrement only if payment_status
//                                          is already "paid" (the common,
//                                          immediate-payment-method case).
//   - checkout.session.async_payment_succeeded -> always decrement (this
//                                          event only fires once payment
//                                          has actually succeeded).
//
// Verifies the webhook signature by hand (HMAC-SHA256 over
// `${timestamp}.${rawBody}`, per Stripe's documented scheme) using the Web
// Crypto API - Pages Functions run on the Workers runtime, not Node, so the
// Stripe SDK's Node-only signature helper doesn't apply, and this keeps the
// function dependency-free (matching the rest of this codebase).
//
// Requires:
//   STRIPE_WEBHOOK_SECRET  - signing secret from the Stripe webhook endpoint
//   DB                     - D1 database binding (see wrangler.toml)
//
// Set up the Stripe webhook endpoint (Developers -> Webhooks -> Add
// endpoint) pointing at /api/stripe-webhook for both the
// `checkout.session.completed` AND `checkout.session.async_payment_succeeded`
// events, and copy its signing secret into STRIPE_WEBHOOK_SECRET. See README.md.

import { UNLIMITED_STOCK_PRODUCT_IDS } from "../_lib/inventory.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.STRIPE_WEBHOOK_SECRET || !env.DB) {
    return new Response("Webhook isn't configured yet.", { status: 500 });
  }

  const signatureHeader = request.headers.get("Stripe-Signature");
  const rawBody = await request.text();

  if (!signatureHeader || !(await verifyStripeSignature(rawBody, signatureHeader, env.STRIPE_WEBHOOK_SECRET))) {
    return new Response("Invalid signature.", { status: 400 });
  }

  const event = JSON.parse(rawBody);

  const isHandledEvent =
    event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded";
  if (!isHandledEvent) {
    return new Response("ok", { status: 200 });
  }

  const session = event.data.object;

  // A `completed` session using a delayed payment method isn't paid yet -
  // wait for the `async_payment_succeeded` event on this same session
  // instead of decrementing now.
  if (event.type === "checkout.session.completed" && session.payment_status !== "paid") {
    return new Response("ok", { status: 200 });
  }

  let items;
  try {
    items = JSON.parse(session.metadata?.items || "[]");
  } catch (err) {
    items = [];
  }

  // Unlimited-stock products (see inventory.js) have no row in D1 at all -
  // never attempt to decrement them.
  const decrementItems = items.filter((item) => !UNLIMITED_STOCK_PRODUCT_IDS.has(item.id));

  const statements = [
    env.DB.prepare("INSERT INTO processed_webhook_events (event_id, session_id) VALUES (?, ?)").bind(
      event.id,
      session.id
    ),
    ...decrementItems.map((item) =>
      env.DB.prepare("UPDATE product_stock SET stock = stock - ? WHERE id = ? AND stock >= ?").bind(
        item.qty,
        item.id,
        item.qty
      )
    ),
  ];

  let results;
  try {
    results = await env.DB.batch(statements);
  } catch (err) {
    // Duplicate event.id -> the events-table insert violates its unique
    // constraint. Stripe redelivers webhooks (at-least-once), so this is
    // the expected way a resend of an already-processed event looks -
    // treat it as already handled rather than decrementing stock again.
    return new Response("ok", { status: 200 });
  }

  // results[0] is the events-table insert; results[1..] are the per-item
  // decrements. A decrement with 0 changes means stock ran out between the
  // checkout-time check and now (a genuine race) - can't be fixed here,
  // just flag it for manual reconciliation.
  results.slice(1).forEach((result, i) => {
    if (result.meta.changes === 0) {
      console.error(`Stock decrement had no effect for product "${decrementItems[i].id}" (session ${session.id}).`);
    }
  });

  return new Response("ok", { status: 200 });
}

export async function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  const parts = {};
  for (const pair of signatureHeader.split(",")) {
    const [key, value] = pair.split("=");
    if (key === "t") parts.t = value;
    if (key === "v1") (parts.v1 = parts.v1 || []).push(value);
  }
  if (!parts.t || !parts.v1 || parts.v1.length === 0) return false;

  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${parts.t}.${rawBody}`)
  );
  const computedSig = [...new Uint8Array(signatureBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

  return parts.v1.some((sig) => timingSafeEqual(computedSig, sig));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
