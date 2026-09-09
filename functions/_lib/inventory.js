// Shared helper for merging the static product catalog (data/products.json -
// name/price/image/description) with live stock counts from D1. Not a route:
// files under functions/ only become routes if they export onRequestX
// handlers, which this file deliberately does not.

// Product ids that always report unlimited stock (-1) and are never tracked
// in D1 - used for the preview-only test item (see products.json /
// products.js) so QA can run checkout end-to-end without eating into real
// inventory. Keep this in sync with the matching id in data/products.json,
// and with the same set imported by stripe-webhook.js so a purchase never
// tries to decrement a row that doesn't exist.
export const UNLIMITED_STOCK_PRODUCT_IDS = new Set(["preview-test-item"]);

export async function fetchCatalog(origin) {
  const res = await fetch(`${origin}/data/products.json`);
  if (!res.ok) throw new Error("Could not load the product catalog.");
  return res.json();
}

export async function getLiveStock(db, ids) {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT id, stock FROM product_stock WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all();
  return new Map(results.map((r) => [r.id, r.stock]));
}

// A product present in products.json but missing from D1 defaults to
// stock 0 (sold out) rather than undefined - safer to undersell than
// oversell if a new product was added to the catalog but never seeded.
// Unlimited-stock products are the deliberate exception: they're never
// queried from or written to D1 at all, and always report stock -1.
export async function mergeLiveStock(products, db) {
  const trackedIds = products.filter((p) => !UNLIMITED_STOCK_PRODUCT_IDS.has(p.id)).map((p) => p.id);
  const stockMap = await getLiveStock(db, trackedIds);
  return products.map((p) =>
    UNLIMITED_STOCK_PRODUCT_IDS.has(p.id) ? { ...p, stock: -1 } : { ...p, stock: stockMap.get(p.id) ?? 0 }
  );
}
