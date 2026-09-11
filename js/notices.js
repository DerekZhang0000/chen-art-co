(function (root) {
  "use strict";

  // Small, generic toast-style notice system: fixed to the top of the
  // viewport (not part of the page's normal content flow, so it never
  // shifts layout), dismissible via an X button, and capped at one visible
  // notice per `type` - calling show() again for a type that's already
  // showing is a no-op rather than stacking a duplicate.
  var CONTAINER_ID = "notice-container";
  var visibleTypes = {};

  function getContainer() {
    var container = document.getElementById(CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = CONTAINER_ID;
      container.className = "notice-container";
      document.body.appendChild(container);
    }
    return container;
  }

  function dismiss(type, el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    delete visibleTypes[type];
  }

  function show(type, message) {
    if (visibleTypes[type]) return;
    visibleTypes[type] = true;

    var notice = document.createElement("div");
    notice.className = "notice";
    notice.setAttribute("data-notice-type", type);
    notice.setAttribute("role", "status");

    var text = document.createElement("span");
    text.className = "notice-text";
    text.textContent = message;
    notice.appendChild(text);

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "notice-close";
    closeBtn.setAttribute("aria-label", "Dismiss");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", function () {
      dismiss(type, notice);
    });
    notice.appendChild(closeBtn);

    getContainer().appendChild(notice);
  }

  var api = { show: show };

  // See the matching comment in js/util.js: both branches here are actually
  // exercised (require() in this file's own test, window injection via
  // domHarness elsewhere), but Node's coverage tool can't merge branch
  // coverage across those two separate script compilations.
  /* node:coverage ignore next 5 */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.ChenNotices = api;
  }
  /* node:coverage ignore next */
})(typeof window !== "undefined" ? window : globalThis);
