(function (root) {
  "use strict";

  // Treats a missing/non-numeric/non-positive `stock` as 0 (unavailable)
  // rather than `undefined`, which previously produced NaN through
  // Math.min(qty, undefined) and got persisted into localStorage. -1 is the
  // sentinel the API uses for unlimited-stock items (see inventory.js) and
  // maps to Infinity, so the same stock-capping math below just works
  // without special-casing it at every call site.
  function stockOf(product) {
    var s = product && product.stock;
    if (s === -1) return Infinity;
    return typeof s === "number" && s > 0 ? s : 0;
  }

  function formatPrice(cents) {
    return "$" + (cents / 100).toFixed(2);
  }

  // Matches the browser's textContent -> innerHTML serialization: only
  // &, <, > are escaped; quotes are left untouched (this is text content,
  // never an attribute value, so quotes don't need escaping).
  function escapeHtml(value) {
    var str = value == null ? "" : String(value);
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Turns a product's optional, modular `attributes` bag (e.g. { size:
  // "Large" }) into a human-readable string like "Size: Large" - generic
  // over whatever keys are present so future attributes need no changes
  // here. Mirrors formatAttributes in functions/api/stripe-webhook.js.
  function formatAttributes(attributes) {
    if (!attributes) return "";
    return Object.keys(attributes)
      .map(function (key) {
        return key.charAt(0).toUpperCase() + key.slice(1) + ": " + attributes[key];
      })
      .join(", ");
  }

  function findProduct(products, id) {
    for (var i = 0; i < products.length; i++) {
      if (products[i].id === id) return products[i];
    }
    return undefined;
  }

  function cartTotalQuantity(cart) {
    return Object.keys(cart).reduce(function (sum, id) { return sum + cart[id]; }, 0);
  }

  function cartSubtotal(cart, products) {
    return Object.keys(cart).reduce(function (sum, id) {
      var product = findProduct(products, id);
      return product ? sum + product.price * cart[id] : sum;
    }, 0);
  }

  // Adds one unit of `id` to `cart`, capped at stock. No-ops (returns the
  // cart unchanged) for an unknown id, a sold-out product, or a product
  // already at its stock limit in the cart.
  function addItem(cart, products, id) {
    var product = findProduct(products, id);
    if (!product) return cart;
    var stock = stockOf(product);
    var current = cart[id] || 0;
    if (current >= stock) return cart;
    cart[id] = current + 1;
    return cart;
  }

  function removeItem(cart, id) {
    delete cart[id];
    return cart;
  }

  // Clamps `qty` to [0, stock]; 0 (or below) removes the item entirely.
  // An unknown id is a no-op.
  function setItemQuantity(cart, products, id, qty) {
    var product = findProduct(products, id);
    if (!product) return cart;
    var stock = stockOf(product);
    var clamped = Math.max(0, Math.min(Math.floor(qty), stock));
    if (clamped === 0) {
      return removeItem(cart, id);
    }
    cart[id] = clamped;
    return cart;
  }

  // Drops cart entries whose product no longer exists in the catalog, and
  // clamps (does not remove) quantities that now exceed available stock -
  // e.g. after the catalog is edited to lower a product's stock.
  function sanitizeCart(cart, products) {
    Object.keys(cart).forEach(function (id) {
      var product = findProduct(products, id);
      if (!product) {
        delete cart[id];
        return;
      }
      var stock = stockOf(product);
      if (cart[id] > stock) cart[id] = stock;
    });
    return cart;
  }

  var api = {
    formatPrice: formatPrice,
    escapeHtml: escapeHtml,
    formatAttributes: formatAttributes,
    findProduct: findProduct,
    stockOf: stockOf,
    cartTotalQuantity: cartTotalQuantity,
    cartSubtotal: cartSubtotal,
    addItem: addItem,
    removeItem: removeItem,
    setItemQuantity: setItemQuantity,
    sanitizeCart: sanitizeCart,
  };

  // See the matching comment in js/util.js: both branches here are actually
  // exercised (require() in this file's own test, window injection via
  // domHarness elsewhere), but Node's coverage tool can't merge branch
  // coverage across those two separate script compilations.
  /* node:coverage ignore next 5 */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.ChenCart = api;
  }
  /* node:coverage ignore next */
})(typeof window !== "undefined" ? window : globalThis);
