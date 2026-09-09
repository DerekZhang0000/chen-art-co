const { test } = require("node:test");
const assert = require("node:assert/strict");
const cart = require("../js/cart.js");

const products = [
  { id: "a", name: "A", price: 1000, stock: 1 },
  { id: "b", name: "B", price: 2500, stock: 3 },
  { id: "c", name: "C", price: 500, stock: 0 },
  { id: "d", name: "D", price: 750 }, // stock intentionally missing
  { id: "unlimited", name: "Unlimited", price: 50, stock: -1 },
];

// ---------- formatPrice ----------

test("formatPrice: typical cents", () => {
  assert.equal(cart.formatPrice(6800), "$68.00");
});

test("formatPrice: zero", () => {
  assert.equal(cart.formatPrice(0), "$0.00");
});

test("formatPrice: negative cents (pinning current behavior, not a spec)", () => {
  assert.equal(cart.formatPrice(-100), "$-1.00");
});

// ---------- escapeHtml ----------

test("escapeHtml: escapes &, <, >", () => {
  assert.equal(cart.escapeHtml("Fish & Chips <tag>"), "Fish &amp; Chips &lt;tag&gt;");
});

test("escapeHtml: leaves quotes untouched (text content, not an attribute)", () => {
  assert.equal(cart.escapeHtml(`She said "hi" and 'bye'`), `She said "hi" and 'bye'`);
});

test("escapeHtml: null/undefined become empty string", () => {
  assert.equal(cart.escapeHtml(null), "");
  assert.equal(cart.escapeHtml(undefined), "");
});

test("escapeHtml: non-string input is coerced", () => {
  assert.equal(cart.escapeHtml(42), "42");
});

// ---------- findProduct ----------

test("findProduct: found and not-found", () => {
  assert.equal(cart.findProduct(products, "a"), products[0]);
  assert.equal(cart.findProduct(products, "nope"), undefined);
});

test("findProduct: empty catalog", () => {
  assert.equal(cart.findProduct([], "a"), undefined);
});

// ---------- cartTotalQuantity / cartSubtotal ----------

test("cartTotalQuantity: empty and multi-item", () => {
  assert.equal(cart.cartTotalQuantity({}), 0);
  assert.equal(cart.cartTotalQuantity({ a: 1, b: 2 }), 3);
});

test("cartSubtotal: sums price * qty across items", () => {
  assert.equal(cart.cartSubtotal({ a: 1, b: 2 }, products), 1000 * 1 + 2500 * 2);
});

test("cartSubtotal: ignores an entry whose id no longer resolves", () => {
  assert.equal(cart.cartSubtotal({ a: 1, ghost: 5 }, products), 1000);
});

// ---------- stockOf ----------

test("stockOf: -1 (unlimited-stock sentinel) reports Infinity", () => {
  assert.equal(cart.stockOf({ stock: -1 }), Infinity);
});

test("stockOf: a normal positive stock passes through unchanged", () => {
  assert.equal(cart.stockOf({ stock: 3 }), 3);
});

// ---------- addItem ----------

test("addItem: increments a fresh item", () => {
  const result = cart.addItem({}, products, "b");
  assert.deepEqual(result, { b: 1 });
});

test("addItem: no-ops at exactly the stock limit", () => {
  const result = cart.addItem({ a: 1 }, products, "a");
  assert.deepEqual(result, { a: 1 });
});

test("addItem: no-ops on an unknown id", () => {
  const result = cart.addItem({}, products, "nope");
  assert.deepEqual(result, {});
});

test("addItem: no-ops when stock is 0", () => {
  const result = cart.addItem({}, products, "c");
  assert.deepEqual(result, {});
});

test("addItem: no-ops when stock is missing (the NaN-cart-corruption fix)", () => {
  const result = cart.addItem({}, products, "d");
  assert.deepEqual(result, {});
});

test("addItem: an unlimited-stock (-1) product is never capped", () => {
  const result = cart.addItem({ unlimited: 999 }, products, "unlimited");
  assert.deepEqual(result, { unlimited: 1000 });
});

// ---------- removeItem ----------

test("removeItem: removes an existing entry", () => {
  assert.deepEqual(cart.removeItem({ a: 1, b: 2 }, "a"), { b: 2 });
});

test("removeItem: no-op on a non-existent id", () => {
  assert.deepEqual(cart.removeItem({ a: 1 }, "nope"), { a: 1 });
});

// ---------- setItemQuantity ----------

test("setItemQuantity: clamps to stock", () => {
  assert.deepEqual(cart.setItemQuantity({}, products, "b", 99), { b: 3 });
});

test("setItemQuantity: 0 or negative removes the item", () => {
  assert.deepEqual(cart.setItemQuantity({ b: 2 }, products, "b", 0), {});
  assert.deepEqual(cart.setItemQuantity({ b: 2 }, products, "b", -5), {});
});

test("setItemQuantity: missing stock is treated as 0 (removes rather than NaN)", () => {
  assert.deepEqual(cart.setItemQuantity({ d: 1 }, products, "d", 2), {});
});

test("setItemQuantity: floors a decimal quantity", () => {
  assert.deepEqual(cart.setItemQuantity({}, products, "b", 2.9), { b: 2 });
});

test("setItemQuantity: no-op on an unknown id", () => {
  assert.deepEqual(cart.setItemQuantity({ a: 1 }, products, "nope", 5), { a: 1 });
});

test("setItemQuantity: an unlimited-stock (-1) product is never clamped", () => {
  assert.deepEqual(cart.setItemQuantity({}, products, "unlimited", 10000), { unlimited: 10000 });
});

// ---------- sanitizeCart ----------

test("sanitizeCart: drops ids no longer in the catalog", () => {
  assert.deepEqual(cart.sanitizeCart({ a: 1, ghost: 3 }, products), { a: 1 });
});

test("sanitizeCart: clamps (does not delete) an over-stock quantity", () => {
  assert.deepEqual(cart.sanitizeCart({ b: 10 }, products), { b: 3 });
});

test("sanitizeCart: a clamped-to-0 entry is left in the cart object (intentional, matches prior behavior)", () => {
  assert.deepEqual(cart.sanitizeCart({ c: 1 }, products), { c: 0 });
});

test("sanitizeCart: an unlimited-stock (-1) product's quantity is left untouched", () => {
  assert.deepEqual(cart.sanitizeCart({ unlimited: 5000 }, products), { unlimited: 5000 });
});
