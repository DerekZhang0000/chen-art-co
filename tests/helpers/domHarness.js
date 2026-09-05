// Shared jsdom harness for testing main.js/shop.js: loads the REAL
// index.html (with its <script> tags stripped) and injects the requested
// script files as genuine inline <script> elements, so they execute
// against a fake DOM exactly as the browser would - this exercises the
// literal artifact the site ships, not a hand-maintained re-description
// of its markup or wiring.
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..", "..");
const INDEX_HTML_PATH = path.join(ROOT, "index.html");

function readSource(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function createDom(options = {}) {
  const rawHtml = fs.readFileSync(INDEX_HTML_PATH, "utf8");
  const strippedHtml = rawHtml.replace(/<script[\s\S]*?<\/script>/gi, "");
  return new JSDOM(strippedHtml, {
    url: options.url || "https://chenart.co/",
    runScripts: "dangerously",
  });
}

function injectScripts(dom, scripts) {
  scripts.forEach((relPath) => {
    const script = dom.window.document.createElement("script");
    script.textContent = readSource(relPath);
    dom.window.document.body.appendChild(script);
  });
}

// Note: this jsdom version makes both `window.location` and
// `location.href` non-configurable, and a real `window.location = url`
// assignment attempts real navigation (which jsdom doesn't implement and
// logs rather than throws). There's no clean way to intercept or read
// back the assigned value, so tests exercising a redirect assert its
// observable side effects (fetch payload, absence of the error path)
// instead of the literal `window.location` value.

// Lets any already-queued microtasks (promise .then chains) drain before
// continuing, regardless of how many `.then` hops are chained.
function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

module.exports = { createDom, injectScripts, flushPromises, readSource };
