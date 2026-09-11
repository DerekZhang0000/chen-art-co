const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDom, injectScripts } = require("./helpers/domHarness.js");

function setup() {
  const dom = createDom();
  injectScripts(dom, ["js/notices.js"]);
  return dom;
}

test("notices: exports via module.exports when loaded as a CommonJS module (not just via window)", () => {
  const { show } = require("../js/notices.js");
  assert.equal(typeof show, "function");
});

test("notices: show() renders a dismissible notice with the given message", () => {
  const dom = setup();
  dom.window.ChenNotices.show("checkout-success", "Thanks for your order!");
  const { document } = dom.window;

  const notice = document.querySelector('.notice[data-notice-type="checkout-success"]');
  assert.ok(notice);
  assert.equal(notice.querySelector(".notice-text").textContent, "Thanks for your order!");
  assert.ok(notice.querySelector(".notice-close"));
});

test("notices: calling show() again for the same type while one is visible does not stack a duplicate", () => {
  const dom = setup();
  dom.window.ChenNotices.show("checkout-success", "First message");
  dom.window.ChenNotices.show("checkout-success", "Second message");
  const { document } = dom.window;

  assert.equal(document.querySelectorAll('.notice[data-notice-type="checkout-success"]').length, 1);
  // The first call wins - it's already showing, so the second is a no-op.
  assert.equal(document.querySelector(".notice-text").textContent, "First message");
});

test("notices: different types can be visible at the same time", () => {
  const dom = setup();
  dom.window.ChenNotices.show("checkout-success", "Order placed");
  dom.window.ChenNotices.show("checkout-cancelled", "Checkout cancelled");
  const { document } = dom.window;

  assert.equal(document.querySelectorAll(".notice").length, 2);
});

test("notices: clicking the close button removes that notice", () => {
  const dom = setup();
  dom.window.ChenNotices.show("checkout-success", "Order placed");
  const { document } = dom.window;

  document.querySelector(".notice-close").click();

  assert.equal(document.querySelectorAll(".notice").length, 0);
});

test("notices: clicking the close button twice in a row (already-removed element) does not throw", () => {
  const dom = setup();
  dom.window.ChenNotices.show("checkout-success", "Order placed");
  const closeBtn = dom.window.document.querySelector(".notice-close");

  closeBtn.click();
  assert.doesNotThrow(() => closeBtn.click());
});

test("notices: after being dismissed, the same type can be shown again", () => {
  const dom = setup();
  dom.window.ChenNotices.show("checkout-success", "Order placed");
  dom.window.document.querySelector(".notice-close").click();

  dom.window.ChenNotices.show("checkout-success", "Order placed again");
  const { document } = dom.window;

  assert.equal(document.querySelectorAll('.notice[data-notice-type="checkout-success"]').length, 1);
  assert.equal(document.querySelector(".notice-text").textContent, "Order placed again");
});
