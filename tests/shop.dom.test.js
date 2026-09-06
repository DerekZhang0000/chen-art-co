const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDom, injectScripts, flushPromises } = require("./helpers/domHarness.js");

const STOCK_PRODUCTS = [
  { id: "in-stock", name: "In Stock Item", price: 1000, image: "images/a.jpg", description: "Desc A", stock: 2 },
  { id: "sold-out", name: "Sold Out Item", price: 2000, image: "images/b.jpg", description: "Desc B", stock: 0 },
  { id: "no-stock-field", name: "No Stock Field Item", price: 500, image: "images/c.jpg", description: "Desc C" },
];

function jsonResponse(data, ok = true) {
  return { ok, json: async () => data, text: async () => JSON.stringify(data) };
}

function setup({ fetchImpl, url } = {}) {
  const dom = createDom({ url });
  if (fetchImpl) dom.window.fetch = fetchImpl;
  injectScripts(dom, ["js/util.js", "js/cart.js", "js/shop.js"]);
  return dom;
}

async function setupWithCatalog(catalog) {
  const dom = setup({ fetchImpl: async () => jsonResponse(catalog) });
  await flushPromises();
  return dom;
}

// ---------- initial render ----------

test("shop: renders product cards from the catalog with correct prices and button states", async () => {
  const dom = await setupWithCatalog(STOCK_PRODUCTS);
  const { document } = dom.window;
  const cards = document.querySelectorAll(".product-card");
  assert.equal(cards.length, 3);

  const inStockBtn = cards[0].querySelector(".product-add");
  assert.equal(inStockBtn.textContent, "Add to cart");
  assert.equal(inStockBtn.disabled, false);
  assert.equal(cards[0].querySelector(".product-price").textContent, "$10.00");

  const soldOutBtn = cards[1].querySelector(".product-add");
  assert.equal(soldOutBtn.textContent, "Sold out");
  assert.equal(soldOutBtn.disabled, true);

  const missingStockBtn = cards[2].querySelector(".product-add");
  assert.equal(missingStockBtn.textContent, "Sold out");
  assert.equal(missingStockBtn.disabled, true);
});

test("shop: products.json fetch rejecting shows the fallback message", async () => {
  const dom = setup({ fetchImpl: async () => { throw new Error("network down"); } });
  await flushPromises();
  const grid = dom.window.document.getElementById("shop-grid");
  assert.match(grid.textContent, /Couldn't load the shop/);
});

// ---------- add to cart ----------

test("shop: add to cart updates the badge and opens the drawer", async () => {
  const dom = await setupWithCatalog(STOCK_PRODUCTS);
  const { document } = dom.window;

  document.querySelectorAll(".product-add")[0].click();

  assert.equal(document.getElementById("cart-count").textContent, "1");
  assert.equal(document.getElementById("cart-count").hidden, false);
  assert.equal(document.getElementById("cart-drawer").classList.contains("open"), true);

  // "in-stock" has stock: 2, so one unit in the cart should NOT be at the
  // limit yet - the button stays active.
  const afterOne = document.querySelectorAll(".product-add")[0];
  assert.equal(afterOne.textContent, "Add to cart");
  assert.equal(afterOne.disabled, false);
});

test("shop: product button flips to 'In cart' once quantity reaches the stock limit", async () => {
  const dom = await setupWithCatalog(STOCK_PRODUCTS);
  const { document } = dom.window;

  document.querySelectorAll(".product-add")[0].click(); // 1 of 2
  document.querySelectorAll(".product-add")[0].click(); // 2 of 2 - now at limit

  const atLimitBtn = document.querySelectorAll(".product-add")[0];
  assert.equal(atLimitBtn.textContent, "In cart");
  assert.equal(atLimitBtn.disabled, true);
  assert.equal(document.getElementById("cart-count").textContent, "2");
});

// ---------- drawer quantity controls ----------

test("shop: drawer quantity +/- respects the stock cap", async () => {
  const dom = await setupWithCatalog(STOCK_PRODUCTS);
  const { document } = dom.window;

  document.querySelectorAll(".product-add")[0].click(); // in-stock, stock: 2, qty now 1
  document.querySelector('[data-action="inc"]').click(); // qty -> 2 (at stock limit)
  assert.equal(document.querySelector(".cart-item-qty span").textContent, "2");

  document.querySelector('[data-action="inc"]').click(); // attempt to exceed stock
  assert.equal(document.querySelector(".cart-item-qty span").textContent, "2");

  document.querySelector('[data-action="dec"]').click();
  document.querySelector('[data-action="dec"]').click(); // qty -> 0, removes the row
  assert.match(document.getElementById("cart-items").textContent, /Your cart is empty/);
});

test("shop: cart-item remove button removes the item", async () => {
  const dom = await setupWithCatalog(STOCK_PRODUCTS);
  const { document } = dom.window;
  document.querySelectorAll(".product-add")[0].click();
  document.querySelector('[data-action="remove"]').click();
  assert.match(document.getElementById("cart-items").textContent, /Your cart is empty/);
  assert.equal(document.getElementById("cart-count").hidden, true);
});

// ---------- checkout ----------

test("shop: checkout button is disabled with an empty cart (no fetch call possible)", async () => {
  const dom = await setupWithCatalog(STOCK_PRODUCTS);
  assert.equal(dom.window.document.getElementById("cart-checkout").disabled, true);
});

test("shop: checkout success calls the API with the cart contents and takes the success path (not the error path)", async () => {
  // jsdom deliberately doesn't implement real navigation, and both
  // `window.location` and `location.href` are non-configurable in this
  // version, so the literal assigned URL can't be observed directly here.
  // Instead this verifies the request shape and that the success branch
  // ran to completion (no error shown, button left mid-redirect rather
  // than reset) - i.e. the code took the `if (result.ok && result.data.url)`
  // branch, not the `.catch`.
  let checkoutRequestBody = null;
  const dom = createDom();
  dom.window.fetch = async (url, init) => {
    if (String(url).includes("products.json")) return jsonResponse(STOCK_PRODUCTS);
    checkoutRequestBody = JSON.parse(init.body);
    return jsonResponse({ url: "https://checkout.stripe.com/session/abc" });
  };
  injectScripts(dom, ["js/util.js", "js/cart.js", "js/shop.js"]);
  await flushPromises();

  dom.window.document.querySelectorAll(".product-add")[0].click();
  const checkoutBtn = dom.window.document.getElementById("cart-checkout");
  checkoutBtn.click();
  await flushPromises();

  assert.deepEqual(checkoutRequestBody, { items: [{ id: "in-stock", qty: 1 }] });
  assert.equal(dom.window.document.getElementById("cart-error").hidden, true);
  assert.equal(checkoutBtn.textContent, "Redirecting…");
});

test("shop: a non-JSON checkout error response shows the friendly fallback, not a raw parser error (regression)", async () => {
  const dom = createDom();
  dom.window.fetch = async (url) => {
    if (String(url).includes("products.json")) return jsonResponse(STOCK_PRODUCTS);
    return { ok: false, text: async () => "Not found" };
  };
  injectScripts(dom, ["js/util.js", "js/cart.js", "js/shop.js"]);
  await flushPromises();

  dom.window.document.querySelectorAll(".product-add")[0].click();
  dom.window.document.getElementById("cart-checkout").click();
  await flushPromises();

  const errorEl = dom.window.document.getElementById("cart-error");
  assert.equal(errorEl.hidden, false);
  assert.equal(errorEl.textContent, "Something went wrong starting checkout.");
  assert.doesNotMatch(errorEl.textContent, /Unexpected token|JSON/);
});

test("shop: a JSON checkout error response shows that exact message", async () => {
  const dom = createDom();
  dom.window.fetch = async (url) => {
    if (String(url).includes("products.json")) return jsonResponse(STOCK_PRODUCTS);
    return { ok: false, text: async () => JSON.stringify({ error: "Only 1 left." }) };
  };
  injectScripts(dom, ["js/util.js", "js/cart.js", "js/shop.js"]);
  await flushPromises();

  dom.window.document.querySelectorAll(".product-add")[0].click();
  dom.window.document.getElementById("cart-checkout").click();
  await flushPromises();

  assert.equal(dom.window.document.getElementById("cart-error").textContent, "Only 1 left.");
});

// ---------- Stripe return redirect ----------

test("shop: ?checkout=success clears the cart and shows the banner", async () => {
  // Deliberately not calling stubLocation here: this test needs jsdom's
  // real location.search parsing, and stubbing replaces the whole object.
  const dom = createDom({ url: "https://chenart.co/?checkout=success#shop" });
  dom.window.fetch = async () => jsonResponse(STOCK_PRODUCTS);
  // Cart clearing happens synchronously, before the products fetch resolves.
  injectScripts(dom, ["js/util.js", "js/cart.js", "js/shop.js"]);

  assert.equal(dom.window.document.getElementById("checkout-success").hidden, false);
  assert.equal(dom.window.localStorage.getItem("chenArtCart"), "{}");
  // The success param must not survive a refresh, or the banner would show forever.
  assert.equal(dom.window.location.search, "");
  assert.equal(dom.window.location.hash, "#shop");
});

// ---------- sanitizing a stale saved cart ----------

test("shop: a saved cart referencing a since-deleted product is dropped after load", async () => {
  const dom = createDom();
  dom.window.localStorage.setItem("chenArtCart", JSON.stringify({ "deleted-product": 2 }));
  dom.window.fetch = async () => jsonResponse(STOCK_PRODUCTS);
  injectScripts(dom, ["js/util.js", "js/cart.js", "js/shop.js"]);
  await flushPromises();

  assert.equal(dom.window.document.getElementById("cart-count").hidden, true);
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("chenArtCart")), {});
});
