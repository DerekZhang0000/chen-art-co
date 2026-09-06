(function () {
  "use strict";

  // ---------- Mobile nav ----------
  var toggle = document.getElementById("nav-toggle");
  var nav = document.getElementById("main-nav");

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var isOpen = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // ---------- Footer year ----------
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // ---------- Gallery lightbox ----------
  var lightbox = document.getElementById("lightbox");
  var lightboxContent = document.getElementById("lightbox-content");
  var lightboxClose = document.getElementById("lightbox-close");

  function openLightbox(item) {
    var type = item.getAttribute("data-type");
    var full = item.getAttribute("data-full");
    var altSource = item.querySelector("img");
    var alt = altSource ? altSource.getAttribute("alt") : "";

    lightboxContent.innerHTML = "";

    if (type === "video") {
      var video = document.createElement("video");
      video.src = full;
      video.poster = item.getAttribute("data-poster") || "";
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      lightboxContent.appendChild(video);
    } else {
      var img = document.createElement("img");
      img.src = full;
      img.alt = alt || "";
      lightboxContent.appendChild(img);
    }

    lightbox.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    lightbox.classList.remove("open");
    lightboxContent.innerHTML = "";
    document.body.style.overflow = "";
  }

  document.querySelectorAll(".gallery-item").forEach(function (item) {
    item.addEventListener("click", function () {
      openLightbox(item);
    });
  });

  if (lightboxClose) lightboxClose.addEventListener("click", closeLightbox);
  if (lightbox) {
    lightbox.addEventListener("click", function (e) {
      if (e.target === lightbox) closeLightbox();
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeLightbox();
  });

  // ---------- Order form ----------
  var form = document.getElementById("order-form");
  var status = document.getElementById("form-status");

  if (form && status) {
    form.addEventListener("submit", function (e) {
      var action = form.getAttribute("action") || "";

      e.preventDefault();
      status.className = "form-status show";
      status.textContent = "Sending...";

      fetch(action, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" },
      })
        .then(function (response) {
          if (response.ok) {
            status.textContent = "Thanks! Your request is in — we'll reply by email soon.";
            status.className = "form-status show ok";
            form.reset();
          } else {
            status.textContent = "Something went wrong. Please email us directly instead.";
            status.className = "form-status show err";
          }
        })
        .catch(function () {
          status.textContent = "Something went wrong. Please email us directly instead.";
          status.className = "form-status show err";
        });
    });
  }
})();
