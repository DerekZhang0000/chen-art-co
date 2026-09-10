// Cloudflare Pages Function: POST /api/create-checkout-session
//
// Builds a Stripe Checkout Session for the items in the visitor's cart and
// hands back its hosted checkout URL. Prices are always looked up from
// data/products.json on the server - the client only ever sends product
// ids and quantities, never prices, so a tampered request can't change
// what gets charged.
//
// Requires a STRIPE_SECRET_KEY environment variable/secret set on the
// Cloudflare Pages project (Settings -> Environment variables), and a D1
// database binding named `DB` for live stock. See README.md for setup steps.

import { fetchCatalog, mergeLiveStock } from "../_lib/inventory.js";

// Domestic-only for now - the studio doesn't currently ship internationally.
const SHIPPING_COUNTRY = "US";
const SHIPPING_RATE_CENTS = 750; // $7.50 flat rate
// Orders made up entirely of unlimited-stock items (e.g. the preview test
// item) have nothing real to ship, but still get charged a nominal $0.01
// rather than $0 so a full checkout - including a non-zero shipping line -
// can be tested end-to-end.
const NOMINAL_SHIPPING_RATE_CENTS = 1;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({ error: "Stripe isn't configured yet on this deployment." }, 500);
  }

  if (!env.DB) {
    return jsonResponse({ error: "Inventory isn't configured yet on this deployment." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return jsonResponse({ error: "Your cart is empty." }, 400);
  }

  const url = new URL(request.url);
  let products;
  try {
    products = await fetchCatalog(url.origin);
  } catch (err) {
    return jsonResponse({ error: "Could not load the product catalog." }, 500);
  }
  products = await mergeLiveStock(products, env.DB);

  const result = buildLineItems(items, products, url.origin);
  if (result.error) {
    return jsonResponse({ error: result.error }, result.status);
  }

  const shippingRateCents = result.shippingRateCents;

  const params = {
    mode: "payment",
    success_url: `${url.origin}/?checkout=success#shop`,
    cancel_url: `${url.origin}/?checkout=cancel#shop`,
    line_items: result.lineItems,
    metadata: { items: JSON.stringify(result.items) },
    // Card-only, on purpose: alternative methods like Link can complete
    // checkout via a saved one-click profile without surfacing the
    // shipping/name form below, so a name/email/address wouldn't be
    // guaranteed. "required" billing address collection similarly ensures
    // customer_details.name is always populated, not just the email.
    payment_method_types: ["card"],
    billing_address_collection: "required",
    shipping_address_collection: { allowed_countries: [SHIPPING_COUNTRY] },
    // Requires Stripe Tax to be enabled in the Dashboard (Settings -> Tax,
    // with an origin address configured) - turning this on without that
    // done first makes Stripe reject every checkout outright.
    automatic_tax: { enabled: true },
    custom_text: {
      after_submit: {
        message: "You'll receive an order confirmation email from Chen Art Co. shortly.",
      },
    },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: shippingRateCents, currency: "usd" },
          display_name: "Standard Shipping",
        },
      },
    ],
  };

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: toFormBody(params),
  });

  const session = await stripeRes.json();

  if (!stripeRes.ok) {
    return jsonResponse({ error: session.error?.message || "Stripe couldn't create a checkout session." }, 502);
  }

  return jsonResponse({ url: session.url });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Validates the requested items against the catalog and builds Stripe's
// line_items shape, or returns { error, status } on the first problem found.
//
// Quantities for the same product id appearing more than once in `items`
// are summed *before* checking against stock - otherwise a request like
// {items:[{id:"x",qty:1},{id:"x",qty:1}]} against a stock:1 product would
// pass two independent stock checks and oversell a one-of-a-kind piece.
export function buildLineItems(items, products, origin) {
  const quantities = new Map();

  for (const item of items) {
    const product = products.find((p) => p.id === item.id);
    if (!product) {
      return { error: `Unknown item: ${item.id}`, status: 400 };
    }

    const quantity = Math.floor(Number(item.qty));
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { error: `Invalid quantity for "${product.name}".`, status: 400 };
    }

    quantities.set(item.id, (quantities.get(item.id) || 0) + quantity);
  }

  const lineItems = [];
  for (const [id, quantity] of quantities) {
    const product = products.find((p) => p.id === id);

    // stock -1 is the unlimited-stock sentinel (see inventory.js) - skip
    // both checks entirely rather than reading it as "sold out"/"-1 left".
    if (product.stock !== -1) {
      if (!product.stock || product.stock < 1) {
        return { error: `"${product.name}" just sold out.`, status: 409 };
      }
      if (quantity > product.stock) {
        return {
          error: `Only ${product.stock} left of "${product.name}" - please lower the quantity.`,
          status: 409,
        };
      }
    }

    lineItems.push({
      quantity,
      price_data: {
        currency: "usd",
        unit_amount: product.price,
        product_data: {
          name: product.name,
          images: [`${origin}/${product.image}`],
        },
      },
    });
  }

  return {
    lineItems,
    // name/price/image ride along in session metadata so the webhook can
    // email a human-readable order summary (with thumbnails) without a
    // second catalog fetch at decrement time - see stripe-webhook.js.
    items: Array.from(quantities, ([id, qty]) => {
      const product = products.find((p) => p.id === id);
      return {
        id,
        qty,
        name: product.name,
        price: product.price,
        image: product.image,
        // Optional, modular per-product properties (e.g. size) - only
        // included when present, so products without any keep the exact
        // same metadata shape as before. See stripe-webhook.js for how
        // these are displayed in the order emails.
        ...(product.attributes ? { attributes: product.attributes } : {}),
      };
    }),
    // Nominal ($0.01) shipping when every item in the order is
    // unlimited-stock (stock -1, e.g. the preview test item) - there's
    // nothing real to ship, but a real (non-zero) shipping line still needs
    // to be testable end-to-end.
    shippingRateCents: Array.from(quantities.keys()).every((id) => products.find((p) => p.id === id).stock === -1)
      ? NOMINAL_SHIPPING_RATE_CENTS
      : SHIPPING_RATE_CENTS,
  };
}

// Stripe's API takes application/x-www-form-urlencoded bodies with
// bracket-notation keys for nested objects/arrays, e.g.
// line_items[0][price_data][currency]=usd - there's no JSON endpoint.
export function toFormBody(obj) {
  const pairs = [];
  (function flatten(value, prefix) {
    if (Array.isArray(value)) {
      value.forEach((v, i) => flatten(v, `${prefix}[${i}]`));
    } else if (value !== null && typeof value === "object") {
      Object.entries(value).forEach(([k, v]) => flatten(v, prefix ? `${prefix}[${k}]` : k));
    } else if (value !== undefined) {
      pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(value)}`);
    }
  })(obj, "");
  return pairs.join("&");
}
