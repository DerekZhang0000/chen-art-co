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
// Once stock is decremented, also sends two emails via Resend - the same
// provider/account as the custom-order form (see send-order.js):
//   - Seller order-notification email (plain text + a lightweight HTML
//     version with item thumbnails), to SELLER_EMAIL.
//   - Buyer order-confirmation email (branded HTML + plain-text fallback),
//     to whatever email address the buyer entered at Stripe Checkout.
// The two sends are independent of each other and of stock accounting: each
// is wrapped in its own try/catch, so a failure or skip in one never affects
// the other or the 200 response. RESEND_API_KEY is required for either to
// fire at all; SELLER_EMAIL is only required for the seller email - the
// buyer email needs no extra config, since Stripe already collected their
// address.
//
// Requires:
//   STRIPE_WEBHOOK_SECRET  - signing secret from the Stripe webhook endpoint
//   DB                     - D1 database binding (see wrangler.toml)
//   RESEND_API_KEY (optional) - enables both order emails below
//   SELLER_EMAIL (optional)  - additionally required for the seller email
//   FROM_EMAIL (optional)    - shared "from" address for both; see
//                          send-order.js for what these mean.
//
// Set up the Stripe webhook endpoint (Developers -> Webhooks -> Add
// endpoint) pointing at /api/stripe-webhook for both the
// `checkout.session.completed` AND `checkout.session.async_payment_succeeded`
// events, and copy its signing secret into STRIPE_WEBHOOK_SECRET. See README.md.

import { UNLIMITED_STOCK_PRODUCT_IDS } from "../_lib/inventory.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  console.log("stripe-webhook: request received");

  if (!env.STRIPE_WEBHOOK_SECRET || !env.DB) {
    console.error(
      `stripe-webhook: not configured (STRIPE_WEBHOOK_SECRET ${env.STRIPE_WEBHOOK_SECRET ? "set" : "MISSING"}, DB ${env.DB ? "bound" : "MISSING"}) - returning 500`
    );
    return new Response("Webhook isn't configured yet.", { status: 500 });
  }

  const origin = new URL(request.url).origin;

  const signatureHeader = request.headers.get("Stripe-Signature");
  const rawBody = await request.text();

  if (!signatureHeader || !(await verifyStripeSignature(rawBody, signatureHeader, env.STRIPE_WEBHOOK_SECRET))) {
    console.error("stripe-webhook: signature missing or invalid - returning 400 (check STRIPE_WEBHOOK_SECRET matches this endpoint's signing secret)");
    return new Response("Invalid signature.", { status: 400 });
  }

  const event = JSON.parse(rawBody);
  console.log(`stripe-webhook: verified event ${event.id} (${event.type})`);

  const isHandledEvent =
    event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded";
  if (!isHandledEvent) {
    console.log(`stripe-webhook: ignoring unhandled event type "${event.type}"`);
    return new Response("ok", { status: 200 });
  }

  const session = event.data.object;

  // A `completed` session using a delayed payment method isn't paid yet -
  // wait for the `async_payment_succeeded` event on this same session
  // instead of decrementing now.
  if (event.type === "checkout.session.completed" && session.payment_status !== "paid") {
    console.log(`stripe-webhook: session ${session.id} completed but payment_status is "${session.payment_status}" - waiting for async_payment_succeeded`);
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
    console.log(`stripe-webhook: event ${event.id} (session ${session.id}) already processed - skipping (no re-decrement, no re-send): ${err.message}`);
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
  console.log(`stripe-webhook: stock decremented for session ${session.id} (${decrementItems.length} tracked item(s))`);

  // Each email is independent - a failure or skip in one must never affect
  // the other, or the 200 response / stock accounting above.
  if (env.RESEND_API_KEY && env.SELLER_EMAIL) {
    try {
      await sendOrderNotificationEmail(session, items, env, origin);
      console.log(`stripe-webhook: seller notification email sent for session ${session.id}`);
    } catch (err) {
      console.error(`Seller order notification email failed for session ${session.id}: ${err.message}`);
    }
  } else {
    console.log(
      `stripe-webhook: skipping seller email for session ${session.id} - ${!env.RESEND_API_KEY ? "RESEND_API_KEY" : "SELLER_EMAIL"} not set`
    );
  }

  if (env.RESEND_API_KEY && session.customer_details?.email) {
    try {
      await sendBuyerConfirmationEmail(session, items, env, origin);
      console.log(`stripe-webhook: buyer confirmation email sent for session ${session.id} to ${session.customer_details.email}`);
    } catch (err) {
      console.error(`Buyer confirmation email failed for session ${session.id}: ${err.message}`);
    }
  } else {
    console.log(
      `stripe-webhook: skipping buyer email for session ${session.id} - ${!env.RESEND_API_KEY ? "RESEND_API_KEY not set" : "no customer_details.email on session"}`
    );
  }

  return new Response("ok", { status: 200 });
}

// Stripe moved the checkout session's shipping address into a nested
// `collected_information.shipping_details` object on newer API versions
// (previously a top-level `shipping_details` field) - read whichever the
// account's current API version actually populates.
function getShippingDetails(session) {
  return session.collected_information?.shipping_details ?? session.shipping_details ?? null;
}

// Turns an item's optional, modular `attributes` bag (e.g. { size: "Large" })
// into a human-readable string like "Size: Large" - generic over whatever
// keys are present so future attributes need no changes here.
function formatAttributes(attributes) {
  if (!attributes) return "";
  return Object.entries(attributes)
    .map(([key, value]) => `${key.charAt(0).toUpperCase()}${key.slice(1)}: ${value}`)
    .join(", ");
}

async function sendOrderNotificationEmail(session, items, env, origin) {
  const fromEmail = env.FROM_EMAIL || "onboarding@resend.dev";
  const sellerEmails = env.SELLER_EMAIL.split(",").map((s) => s.trim()).filter(Boolean);

  const buyerEmail = session.customer_details?.email || "(not provided)";
  const buyerName = session.customer_details?.name || "(not provided)";
  const total = `${formatCents(session.amount_total)} ${(session.currency || "usd").toUpperCase()}`;
  const subtotal = formatCents(session.amount_subtotal);
  const shippingCost = formatCents(session.total_details?.amount_shipping ?? 0);
  const tax = formatCents(session.total_details?.amount_tax ?? 0);
  const shippingDetails = getShippingDetails(session);

  const lines = [
    `Buyer: ${buyerName} <${buyerEmail}>`,
    "",
    "Items:",
    ...items.map(
      (item) =>
        `  ${item.qty} x ${item.name || item.id}${item.attributes ? ` (${formatAttributes(item.attributes)})` : ""} (${formatCents(item.price)} each)`
    ),
    "",
    `Subtotal: ${subtotal}`,
    `Shipping: ${shippingCost}`,
    `Tax: ${tax}`,
    `Order total: ${total}`,
    "",
    "Shipping address:",
    formatShippingAddress(shippingDetails),
    "",
    `Stripe session: ${session.id}`,
  ];

  // Item thumbnails are embedded (CID) rather than linked, so they render
  // even when `origin` isn't publicly reachable (e.g. local dev) and
  // without the "click to load images" friction some inboxes impose on
  // remote-hosted images.
  const itemImages = await Promise.all(
    items.map((item, i) => (item.image ? fetchImageAttachment(origin, item.image, `item-${i}`) : null))
  );

  // Deliberately plain - just the existing text layout with a thumbnail
  // next to each item line, not the buyer email's branded template.
  const html = [
    `<p>Buyer: ${escapeHtml(buyerName)} &lt;${escapeHtml(buyerEmail)}&gt;</p>`,
    "<p>Items:</p>",
    "<table cellpadding=\"4\" cellspacing=\"0\">",
    items
      .map(
        (item, i) => `<tr>
      <td>${itemImages[i] ? `<img src="cid:item-${i}" width="40" height="40" alt="" style="object-fit:cover;border-radius:2px;" />` : ""}</td>
      <td>${item.qty} x ${escapeHtml(item.name || item.id)}${item.attributes ? ` (${escapeHtml(formatAttributes(item.attributes))})` : ""} (${formatCents(item.price)} each)</td>
    </tr>`
      )
      .join(""),
    "</table>",
    `<p>Subtotal: ${subtotal}<br>Shipping: ${shippingCost}<br>Tax: ${tax}<br>Order total: ${total}</p>`,
    `<p>Shipping address:<br>${formatShippingAddressHtml(shippingDetails)}</p>`,
    `<p>Stripe session: ${escapeHtml(session.id)}</p>`,
  ].join("\n");

  const attachments = itemImages.filter(Boolean);

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: sellerEmails,
      subject: `New order from ${buyerName !== "(not provided)" ? buyerName : buyerEmail}`,
      text: lines.join("\n"),
      html,
      ...(attachments.length ? { attachments } : {}),
    }),
  });

  if (!resendRes.ok) {
    const errorBody = await resendRes.json().catch(() => ({}));
    throw new Error(errorBody.message || `Resend responded with ${resendRes.status}`);
  }
}

// Branded HTML confirmation to the buyer, with a plain-text fallback.
// Needs only RESEND_API_KEY (not SELLER_EMAIL) - the recipient comes from
// what the buyer entered at Stripe Checkout, not from seller config.
async function sendBuyerConfirmationEmail(session, items, env, origin) {
  const fromEmail = env.FROM_EMAIL || "onboarding@resend.dev";
  const buyerEmail = session.customer_details.email;
  const buyerName = session.customer_details?.name || "";
  const total = `${formatCents(session.amount_total)} ${(session.currency || "usd").toUpperCase()}`;
  const subtotal = formatCents(session.amount_subtotal);
  const shippingCost = formatCents(session.total_details?.amount_shipping ?? 0);
  const tax = formatCents(session.total_details?.amount_tax ?? 0);
  const shippingDetails = getShippingDetails(session);

  const text = [
    buyerName ? `Hi ${buyerName},` : "Hi,",
    "",
    "Thanks for your order from Chen Art Co.! Here's your confirmation:",
    "",
    "Items:",
    ...items.map(
      (item) =>
        `  ${item.qty} x ${item.name || item.id}${item.attributes ? ` (${formatAttributes(item.attributes)})` : ""} (${formatCents(item.price)} each)`
    ),
    "",
    `Subtotal: ${subtotal}`,
    `Shipping: ${shippingCost}`,
    `Tax: ${tax}`,
    `Order total: ${total}`,
    "",
    "Shipping address:",
    formatShippingAddress(shippingDetails),
    "",
    `Order reference: ${session.id}`,
    "",
    "- Chen Art Co.",
  ].join("\n");

  // Embed the logo and item thumbnails via CID rather than linking to
  // `origin` - see the matching comment in sendOrderNotificationEmail.
  const logoAttachment = await fetchImageAttachment(origin, "images/logo.png", "logo");
  const itemImages = await Promise.all(
    items.map((item, i) => (item.image ? fetchImageAttachment(origin, item.image, `item-${i}`) : null))
  );

  const itemRows = items
    .map(
      (item, i) => `<tr>
        <td style="padding:12px 0;border-bottom:1px solid #eee;" width="64">
          ${itemImages[i] ? `<img src="cid:item-${i}" width="56" height="56" alt="" style="display:block;border-radius:4px;object-fit:cover;" />` : ""}
        </td>
        <td style="padding:12px 0 12px 16px;border-bottom:1px solid #eee;font-family:Arial,Helvetica,sans-serif;color:#000000;">
          <div style="font-weight:600;">${escapeHtml(item.name || item.id)}</div>
          ${item.attributes ? `<div style="color:#555555;font-size:13px;">${escapeHtml(formatAttributes(item.attributes))}</div>` : ""}
          <div style="color:#555555;font-size:13px;">Qty ${item.qty} &times; ${formatCents(item.price)}</div>
        </td>
      </tr>`
    )
    .join("");

  const html = `<div style="background:#faf8f9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:4px;overflow:hidden;">
    <tr>
      <td style="background:#22062a;padding:28px 24px;text-align:center;">
        ${logoAttachment ? `<img src="cid:logo" alt="" width="40" height="40" style="display:inline-block;vertical-align:middle;margin-right:10px;" />` : ""}
        <span style="color:#f3ecf5;font-size:20px;font-family:Georgia,'Times New Roman',serif;vertical-align:middle;">Chen Art Co.</span>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 24px 8px;">
        <h1 style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#000000;">Thank you for your order${buyerName ? `, ${escapeHtml(buyerName)}` : ""}!</h1>
        <p style="margin:0;color:#555555;font-size:14px;">We're getting your order ready. Here's a summary:</p>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 24px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows}</table>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 24px;text-align:right;">
        <p style="margin:0 0 4px;font-size:13px;color:#555555;">Subtotal: ${subtotal}</p>
        <p style="margin:0 0 4px;font-size:13px;color:#555555;">Shipping: ${shippingCost}</p>
        <p style="margin:0 0 8px;font-size:13px;color:#555555;">Tax: ${tax}</p>
        <span style="font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#ff0000;font-weight:600;">Total: ${total}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 24px;">
        <p style="margin:0 0 4px;font-size:13px;color:#555555;font-weight:600;">Shipping address</p>
        <p style="margin:0;font-size:14px;color:#000000;">${formatShippingAddressHtml(shippingDetails)}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 24px;background:#faf8f9;border-top:1px solid #eee;text-align:center;">
        <p style="margin:0 0 4px;font-size:13px;color:#555555;">Order reference: ${escapeHtml(session.id)}</p>
        <p style="margin:0;font-size:13px;color:#555555;">
          <a href="${escapeHtml(origin)}" style="color:#22062a;">chenart.co</a> &middot; &copy; Chen Art Co.
        </p>
      </td>
    </tr>
  </table>
</div>`;

  const attachments = [logoAttachment, ...itemImages].filter(Boolean);

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [buyerEmail],
      subject: "Your Chen Art Co. order confirmation",
      text,
      html,
      ...(attachments.length ? { attachments } : {}),
    }),
  });

  if (!resendRes.ok) {
    const errorBody = await resendRes.json().catch(() => ({}));
    throw new Error(errorBody.message || `Resend responded with ${resendRes.status}`);
  }
}

// Fetches an image from this same site (origin) and returns it as a Resend
// inline attachment ({filename, content: base64, content_id}), referenced
// in HTML via `<img src="cid:<contentId>">`. Returns null on any failure so
// callers can just omit the <img> tag - a broken image fetch should never
// fail the whole email.
async function fetchImageAttachment(origin, imagePath, contentId) {
  try {
    const res = await fetch(`${origin}/${imagePath}`);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { filename: imagePath.split("/").pop() || "image", content: btoa(binary), content_id: contentId };
  } catch (err) {
    return null;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatShippingAddress(shippingDetails) {
  const address = shippingDetails?.address;
  if (!address) return "  (no shipping address on file)";

  return [
    shippingDetails.name,
    address.line1,
    address.line2,
    `${address.city || ""}, ${address.state || ""} ${address.postal_code || ""}`.trim(),
    address.country,
  ]
    .filter(Boolean)
    .map((line) => `  ${line}`)
    .join("\n");
}

function formatShippingAddressHtml(shippingDetails) {
  const address = shippingDetails?.address;
  if (!address) return "(no shipping address on file)";

  return [
    shippingDetails.name,
    address.line1,
    address.line2,
    `${address.city || ""}, ${address.state || ""} ${address.postal_code || ""}`.trim(),
    address.country,
  ]
    .filter(Boolean)
    .map((line) => escapeHtml(line))
    .join("<br>");
}

function formatCents(cents) {
  return typeof cents === "number" ? "$" + (cents / 100).toFixed(2) : "$0.00";
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
