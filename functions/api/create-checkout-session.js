// Cloudflare Pages Function: POST /api/create-checkout-session
//
// Builds a Stripe Checkout Session for the items in the visitor's cart and
// hands back its hosted checkout URL. Prices are always looked up from
// data/products.json on the server - the client only ever sends product
// ids and quantities, never prices, so a tampered request can't change
// what gets charged.
//
// Requires a STRIPE_SECRET_KEY environment variable/secret set on the
// Cloudflare Pages project (Settings -> Environment variables). See
// README.md for setup steps.

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({ error: "Stripe isn't configured yet on this deployment." }, 500);
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
  const productsRes = await fetch(`${url.origin}/data/products.json`);
  if (!productsRes.ok) {
    return jsonResponse({ error: "Could not load the product catalog." }, 500);
  }
  const products = await productsRes.json();

  const result = buildLineItems(items, products, url.origin);
  if (result.error) {
    return jsonResponse({ error: result.error }, result.status);
  }

  const params = {
    mode: "payment",
    success_url: `${url.origin}/?checkout=success#shop`,
    cancel_url: `${url.origin}/?checkout=cancel#shop`,
    line_items: result.lineItems,
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

    if (!product.stock || product.stock < 1) {
      return { error: `"${product.name}" just sold out.`, status: 409 };
    }
    if (quantity > product.stock) {
      return {
        error: `Only ${product.stock} left of "${product.name}" - please lower the quantity.`,
        status: 409,
      };
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

  return { lineItems };
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
