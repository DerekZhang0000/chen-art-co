const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDom, injectScripts, flushPromises } = require("./helpers/domHarness.js");

function setup() {
  const dom = createDom();
  injectScripts(dom, ["js/main.js"]);
  return dom;
}

function setupWithoutElement(id) {
  const dom = createDom();
  const el = dom.window.document.getElementById(id);
  el.parentNode.removeChild(el);
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

test("main: doesn't crash when nav-toggle is absent from the page (nothing to wire up)", () => {
  assert.doesNotThrow(() => setupWithoutElement("nav-toggle"));
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
  const dom = createDom();
  const { document } = dom.window;
  // The real gallery is currently image-only (see gallery-grid in index.html),
  // but the lightbox's video-handling code path still needs coverage - add a
  // synthetic video item before main.js runs (its click handlers are bound
  // once, at load time, via querySelectorAll - not delegated).
  document.getElementById("gallery-grid").insertAdjacentHTML(
    "beforeend",
    '<button class="gallery-item" data-full="videos/sample.mp4" data-type="video" data-poster="images/sample-poster.jpg">' +
      '<img src="images/sample-poster.jpg" alt="" /></button>'
  );
  injectScripts(dom, ["js/main.js"]);

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

test("main: doesn't crash when lightbox-close is absent (nothing to wire up)", () => {
  assert.doesNotThrow(() => setupWithoutElement("lightbox-close"));
});

test("main: doesn't crash when the lightbox itself is absent (nothing to wire up)", () => {
  assert.doesNotThrow(() => setupWithoutElement("lightbox"));
});

test("main: lightbox image alt falls back to '' when the gallery item has no <img> child", () => {
  const dom = createDom();
  const { document } = dom.window;
  document.getElementById("gallery-grid").insertAdjacentHTML(
    "beforeend",
    '<button class="gallery-item" data-full="images/no-alt.jpg" data-type="image"></button>'
  );
  injectScripts(dom, ["js/main.js"]);

  const item = document.querySelectorAll(".gallery-item");
  item[item.length - 1].click();

  assert.equal(document.querySelector("#lightbox-content img").getAttribute("alt"), "");
});

test("main: video poster falls back to '' when data-poster is absent", () => {
  const dom = createDom();
  const { document } = dom.window;
  document.getElementById("gallery-grid").insertAdjacentHTML(
    "beforeend",
    '<button class="gallery-item" data-full="videos/sample.mp4" data-type="video"><img src="images/sample-poster.jpg" alt="" /></button>'
  );
  injectScripts(dom, ["js/main.js"]);

  document.querySelector('.gallery-item[data-type="video"]').click();

  assert.equal(document.querySelector("#lightbox-content video").getAttribute("poster"), "");
});

// ---------- order form ----------

function dispatchSubmit(dom, form) {
  const event = new dom.window.Event("submit", { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  return event;
}

test("main: validateReferenceImages treats a null `files` property as no files", async () => {
  const dom = setup();
  const { document } = dom.window;
  const form = document.getElementById("order-form");
  const referenceImages = document.getElementById("reference-images");
  Object.defineProperty(referenceImages, "files", { value: null, configurable: true });
  document.getElementById("name").value = "Ada";

  let fetchCalled = false;
  dom.window.fetch = async () => { fetchCalled = true; return { ok: true }; };

  dispatchSubmit(dom, form);
  await flushPromises();

  assert.equal(fetchCalled, true); // no files -> nothing to reject
});

test("main: submitting the order form intercepts the submit and posts to the configured action", () => {
  const dom = setup();
  const { document } = dom.window;
  const form = document.getElementById("order-form");
  assert.equal(form.getAttribute("action"), "/api/send-order"); // sanity check on the repo's current pre-launch state

  dom.window.fetch = async () => new Promise(() => {}); // never resolves; we only care that it was called

  const event = dispatchSubmit(dom, form);
  assert.equal(event.defaultPrevented, true);
});

test("main: successful submission shows the thank-you message and resets the form", async () => {
  const dom = setup();
  const { document } = dom.window;
  const form = document.getElementById("order-form");
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
  dom.window.fetch = async () => { throw new Error("network down"); };

  dispatchSubmit(dom, form);
  await flushPromises();

  const status = document.getElementById("form-status");
  assert.match(status.textContent, /Something went wrong/);
  assert.equal(status.className.includes("err"), true);
});

function stubFiles(input, files) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
}

test("main: more than 5 reference images blocks submission with an error and never calls fetch", async () => {
  const dom = setup();
  const { document } = dom.window;
  const form = document.getElementById("order-form");
  const referenceImages = document.getElementById("reference-images");
  stubFiles(referenceImages, Array.from({ length: 6 }, (_, i) => new dom.window.File(["x"], `ref-${i}.png`, { type: "image/png" })));

  let fetchCalled = false;
  dom.window.fetch = async () => { fetchCalled = true; return { ok: true }; };

  dispatchSubmit(dom, form);
  await flushPromises();

  assert.equal(fetchCalled, false);
  const error = document.getElementById("reference-images-error");
  assert.match(error.textContent, /up to 5 images/);
  assert.equal(error.className.includes("show"), true);
  assert.match(document.getElementById("form-status").textContent, /fix the reference images/);
});

test("main: a reference image over 6MB blocks submission with an error", async () => {
  const dom = setup();
  const { document } = dom.window;
  const form = document.getElementById("order-form");
  const referenceImages = document.getElementById("reference-images");
  const bigFile = new dom.window.File(["x"], "big.png", { type: "image/png" });
  Object.defineProperty(bigFile, "size", { value: 6 * 1024 * 1024 + 1 });
  stubFiles(referenceImages, [bigFile]);

  let fetchCalled = false;
  dom.window.fetch = async () => { fetchCalled = true; return { ok: true }; };

  dispatchSubmit(dom, form);
  await flushPromises();

  assert.equal(fetchCalled, false);
  const error = document.getElementById("reference-images-error");
  assert.match(error.textContent, /6MB or smaller/);
});

test("main: skips reference-image validation entirely when those elements are absent from the page", async () => {
  const dom = setupWithoutElement("reference-images-error");
  const { document } = dom.window;
  const form = document.getElementById("order-form");
  document.getElementById("name").value = "Ada";

  let fetchCalled = false;
  dom.window.fetch = async () => { fetchCalled = true; return { ok: true }; };

  dispatchSubmit(dom, form);
  await flushPromises();

  assert.equal(fetchCalled, true);
});

test("main: doesn't crash when order-form/form-status are absent (nothing to wire up)", () => {
  assert.doesNotThrow(() => setupWithoutElement("order-form"));
});

test("main: a form with no action attribute posts to '' instead of crashing", async () => {
  const dom = createDom();
  const { document } = dom.window;
  document.getElementById("order-form").removeAttribute("action");
  injectScripts(dom, ["js/main.js"]);

  const form = document.getElementById("order-form");
  document.getElementById("name").value = "Ada";

  let requestedUrl = null;
  dom.window.fetch = async (url) => { requestedUrl = url; return { ok: true }; };

  dispatchSubmit(dom, form);
  await flushPromises();

  assert.equal(requestedUrl, "");
});

test("main: valid reference images submit normally and clear any prior error", async () => {
  const dom = setup();
  const { document } = dom.window;
  const form = document.getElementById("order-form");
  const referenceImages = document.getElementById("reference-images");
  document.getElementById("name").value = "Ada";
  stubFiles(referenceImages, [new dom.window.File(["x"], "sketch.png", { type: "image/png" })]);

  let fetchCalled = false;
  dom.window.fetch = async () => { fetchCalled = true; return { ok: true }; };

  dispatchSubmit(dom, form);
  await flushPromises();

  assert.equal(fetchCalled, true);
  const error = document.getElementById("reference-images-error");
  assert.equal(error.className.includes("show"), false);
  assert.match(document.getElementById("form-status").textContent, /Thanks!/);
});
