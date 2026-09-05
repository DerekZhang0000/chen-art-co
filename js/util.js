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

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.ChenUtil = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
