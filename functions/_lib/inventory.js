// Shared helper for merging the static product catalog (data/products.json -
// name/price/image/description) with live stock counts from D1. Not a route:
// files under functions/ only become routes if they export onRequestX
// handlers, which this file deliberately does not.

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
export async function mergeLiveStock(products, db) {
  const stockMap = await getLiveStock(db, products.map((p) => p.id));
  return products.map((p) => ({ ...p, stock: stockMap.get(p.id) ?? 0 }));
}
