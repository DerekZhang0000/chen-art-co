const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDom, injectScripts, flushPromises } = require("./helpers/domHarness.js");

function setup() {
  const dom = createDom();
  injectScripts(dom, ["js/main.js"]);
  return dom;
}

// ---------- mobile nav ----------

test("main: nav toggle opens and closes across two clicks, updating aria-expanded", () => {
  const dom = setup();
  const { document } = dom.window;
  const toggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("main-nav");

  toggle.click();
  assert.equal(nav.classList.contains("open"), true);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");

  toggle.click();
  assert.equal(nav.classList.contains("open"), false);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
});

test("main: clicking a nav link closes the menu", () => {
  const dom = setup();
  const { document } = dom.window;
  const toggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("main-nav");

  toggle.click();
  assert.equal(nav.classList.contains("open"), true);

  nav.querySelector("a").click();
  assert.equal(nav.classList.contains("open"), false);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
});

// ---------- footer year ----------

test("main: footer year is set to the current year", () => {
  const dom = setup();
  assert.equal(dom.window.document.getElementById("year").textContent, String(new Date().getFullYear()));
});

// ---------- lightbox ----------

test("main: lightbox opens an <img> for an image gallery item", () => {
  const dom = setup();
  const { document } = dom.window;
  const imageItem = document.querySelector('.gallery-item[data-type="image"]');
  imageItem.click();

  const lightbox = document.getElementById("lightbox");
  const content = document.getElementById("lightbox-content");
  assert.equal(lightbox.classList.contains("open"), true);
  assert.equal(content.querySelector("img").getAttribute("src"), imageItem.getAttribute("data-full"));
  assert.equal(content.querySelector("video"), null);
});

test("main: lightbox opens a <video> with src/poster/controls for a video gallery item", () => {
  const dom = setup();
  const { document } = dom.window;
  const videoItem = document.querySelector('.gallery-item[data-type="video"]');
  videoItem.click();

  const content = document.getElementById("lightbox-content");
  const video = content.querySelector("video");
  assert.ok(video);
  assert.equal(video.getAttribute("src"), videoItem.getAttribute("data-full"));
  assert.equal(video.getAttribute("poster"), videoItem.getAttribute("data-poster"));
  assert.equal(video.controls, true);
  assert.equal(video.autoplay, true);
  assert.equal(video.playsInline, true);
});

test("main: lightbox closes via the close button, backdrop click, and Escape", () => {
  const dom = setup();
  const { document } = dom.window;
  const lightbox = document.getElementById("lightbox");

  document.querySelector(".gallery-item").click();
  assert.equal(lightbox.classList.contains("open"), true);
  document.getElementById("lightbox-close").click();
  assert.equal(lightbox.classList.contains("open"), false);
  assert.equal(document.getElementById("lightbox-content").innerHTML, "");

  document.querySelector(".gallery-item").click();
  lightbox.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(lightbox.classList.contains("open"), false);

  document.querySelector(".gallery-item").click();
  document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(lightbox.classList.contains("open"), false);
});

test("main: clicking inside the lightbox content does not close it", () => {
  const dom = setup();
  const { document } = dom.window;
  const lightbox = document.getElementById("lightbox");

  document.querySelector(".gallery-item").click();
  document.getElementById("lightbox-content").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(lightbox.classList.contains("open"), true);
});

// ---------- order form ----------

function dispatchSubmit(dom, form) {
  const event = new dom.window.Event("submit", { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  return event;
}

test("main: submitting with the placeholder Formspree action just warns and does not intercept the submit", () => {
  const dom = setup();
  const { document } = dom.window;
  const form = document.getElementById("order-form");
  assert.match(form.getAttribute("action"), /YOUR_FORM_ID/); // sanity check on the repo's current pre-launch state

  const warnings = [];
  const originalWarn = dom.window.console.warn;
  dom.window.console.warn = (msg) => warnings.push(msg);

  try {
    const event = dispatchSubmit(dom, form);
    assert.equal(event.defaultPrevented, false);
    assert.ok(warnings.some((w) => /placeholder/i.test(w)));
  } finally {
    dom.window.console.warn = originalWarn;
  }
});

test("main: successful submission shows the thank-you message and resets the form", async () => {
  const dom = setup();
  const { document } = dom.window;
  const form = document.getElementById("order-form");
  form.setAttribute("action", "https://formspree.io/f/real123");
  document.getElementById("name").value = "Ada";

  dom.window.fetch = async () => ({ ok: true });

  const event = dispatchSubmit(dom, form);
  assert.equal(event.defaultPrevented, true);
  await flushPromises();

  const status = document.getElementById("form-status");
  assert.match(status.textContent, /Thanks!/);
  assert.equal(status.className.includes("ok"), true);
  assert.equal(document.getElementById("name").value, "");
});

test("main: a non-ok response shows the fallback error text", async () => {
  const dom = setup();
  const { document } = dom.window;
  const form = document.getElementById("order-form");
  form.setAttribute("action", "https://formspree.io/f/real123");
  dom.window.fetch = async () => ({ ok: false });

  dispatchSubmit(dom, form);
  await flushPromises();

  const status = document.getElementById("form-status");
  assert.match(status.textContent, /Something went wrong/);
  assert.equal(status.className.includes("err"), true);
});

test("main: a network-level fetch rejection shows the same fallback error text", async () => {
  const dom = setup();
  const { document } = dom.window;
  const form = document.getElementById("order-form");
  form.setAttribute("action", "https://formspree.io/f/real123");
  dom.window.fetch = async () => { throw new Error("network down"); };

  dispatchSubmit(dom, form);
  await flushPromises();

  const status = document.getElementById("form-status");
  assert.match(status.textContent, /Something went wrong/);
  assert.equal(status.className.includes("err"), true);
});
