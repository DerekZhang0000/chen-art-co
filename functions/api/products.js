// Cloudflare Pages Function: GET /api/products
//
// Returns the product catalog (data/products.json) merged with live stock
// counts from D1, so the Shop page always reflects real inventory instead
// of a static, manually-edited number.
//
// Requires a D1 database binding named `DB` on the Cloudflare Pages
// project (see wrangler.toml / README.md).

import { fetchCatalog, mergeLiveStock } from "../_lib/inventory.js";

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.DB) {
    return jsonResponse({ error: "Inventory isn't configured yet on this deployment." }, 500);
  }

  const url = new URL(request.url);
  let products;
  try {
    products = await fetchCatalog(url.origin);
  } catch (err) {
    return jsonResponse({ error: "Could not load the product catalog." }, 500);
  }

  const merged = await mergeLiveStock(products, env.DB);
  return jsonResponse(merged);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
