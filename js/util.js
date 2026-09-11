(function (root) {
  "use strict";

  // Parses `text` as JSON. Returns {} only on genuine parse failure (e.g. an
  // HTML/plain-text error page) - an empty string is treated the same way,
  // since fetch responses with no body are common on error paths. A literal
  // "null" body parses to `null`, not {} - only a parse *failure* falls back.
  function safeParseJson(text) {
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (err) {
      return {};
    }
  }

  var api = { safeParseJson: safeParseJson };

  // This module-detection boilerplate is exercised through two genuinely
  // separate paths - a direct `require()` in tests/util.test.js (module
  // branch) and browser-style <script> injection via
  // tests/helpers/domHarness.js (window branch, see tests/shop.dom.test.js)
  // - confirmed by hand. Node's coverage tool can't merge branch coverage
  // across those two distinct script compilations of the same file, so it
  // under-reports this boilerplate as partially uncovered.
  /* node:coverage ignore next 5 */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.ChenUtil = api;
  }
  /* node:coverage ignore next */
})(typeof window !== "undefined" ? window : globalThis);
