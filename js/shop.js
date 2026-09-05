(function () {
  "use strict";

  var CART_KEY = "chenArtCart"; // { [productId]: quantity }

  var products = [];
  var cart = loadCart();

  var shopGrid = document.getElementById("shop-grid");
  var cartToggle = document.getElementById("cart-toggle");
  var cartCount = document.getElementById("cart-count");
  var cartOverlay = document.getElementById("cart-overlay");
  var cartDrawer = document.getElementById("cart-drawer");
  var cartClose = document.getElementById("cart-close");
  var cartItemsEl = document.getElementById("cart-items");
  var cartSubtotalEl = document.getElementById("cart-subtotal");
  var cartCheckoutBtn = document.getElementById("cart-checkout");
  var cartErrorEl = document.getElementById("cart-error");
  var checkoutBanner = document.getElementById("checkout-success");

  if (!shopGrid) return;

  function loadCart() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch (err) {
      // Storage unavailable (private browsing, etc.) - cart just won't persist across reloads.
    }
  }

  var formatPrice = ChenCart.formatPrice;
  var escapeHtml = ChenCart.escapeHtml;

  function findProduct(id) {
    return ChenCart.findProduct(products, id);
  }

  function renderProducts() {
    if (products.length === 0) {
      shopGrid.innerHTML = '<p class="shop-loading">Nothing in stock right now - check back soon.</p>';
      return;
    }

    shopGrid.innerHTML = "";
    products.forEach(function (product) {
      var inCart = cart[product.id] || 0;
      var soldOut = !product.stock || product.stock < 1;
      var atLimit = inCart >= product.stock;

      var card = document.createElement("div");
      card.className = "product-card";
      card.innerHTML =
        '<div class="product-image"><img src="' + product.image + '" alt="' + escapeHtml(product.name) + '" loading="lazy" /></div>' +
        '<div class="product-body">' +
        "<h4>" + escapeHtml(product.name) + "</h4>" +
        '<p class="product-desc">' + escapeHtml(product.description) + "</p>" +
        '<div class="product-foot">' +
        '<span class="product-price">' + formatPrice(product.price) + "</span>" +
        "</div>" +
        "</div>";

      var foot = card.querySelector(".product-foot");
      var button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-outline-dark product-add";

      if (soldOut) {
        button.textContent = "Sold out";
        button.disabled = true;
      } else if (atLimit) {
        button.textContent = "In cart";
        button.disabled = true;
      } else {
        button.textContent = "Add to cart";
        button.addEventListener("click", function () {
          addToCart(product.id);
        });
      }

      foot.appendChild(button);
      shopGrid.appendChild(card);
    });
  }

  function addToCart(id) {
    cart = ChenCart.addItem(cart, products, id);
    saveCart();
    renderProducts();
    renderCart();
    openCart();
  }

  function removeFromCart(id) {
    cart = ChenCart.removeItem(cart, id);
    saveCart();
    renderProducts();
    renderCart();
  }

  function setQuantity(id, qty) {
    cart = ChenCart.setItemQuantity(cart, products, id, qty);
    saveCart();
    renderProducts();
    renderCart();
  }

  function renderCart() {
    var ids = Object.keys(cart).filter(function (id) { return cart[id] > 0 && findProduct(id); });

    if (cartCount) {
      var total = ChenCart.cartTotalQuantity(cart);
      cartCount.textContent = total;
      cartCount.hidden = total === 0;
    }

    if (ids.length === 0) {
      cartItemsEl.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
      cartSubtotalEl.textContent = formatPrice(0);
      cartCheckoutBtn.disabled = true;
      return;
    }

    var subtotal = 0;
    cartItemsEl.innerHTML = "";

    ids.forEach(function (id) {
      var product = findProduct(id);
      var qty = cart[id];
      subtotal += product.price * qty;

      var row = document.createElement("div");
      row.className = "cart-item";
      row.innerHTML =
        '<img src="' + product.image + '" alt="' + escapeHtml(product.name) + '" />' +
        '<div class="cart-item-body">' +
        "<h5>" + escapeHtml(product.name) + "</h5>" +
        '<span class="cart-item-price">' + formatPrice(product.price) + "</span>" +
        '<div class="cart-item-qty">' +
        '<button type="button" class="qty-btn" data-action="dec" aria-label="Decrease quantity">&minus;</button>' +
        '<span>' + qty + "</span>" +
        '<button type="button" class="qty-btn" data-action="inc" aria-label="Increase quantity">+</button>' +
        '<button type="button" class="cart-item-remove" data-action="remove">Remove</button>' +
        "</div>" +
        "</div>";

      row.querySelector('[data-action="dec"]').addEventListener("click", function () {
        setQuantity(id, qty - 1);
      });
      row.querySelector('[data-action="inc"]').addEventListener("click", function () {
        setQuantity(id, qty + 1);
      });
      row.querySelector('[data-action="remove"]').addEventListener("click", function () {
        removeFromCart(id);
      });

      cartItemsEl.appendChild(row);
    });

    cartSubtotalEl.textContent = formatPrice(subtotal);
    cartCheckoutBtn.disabled = false;
  }

  function openCart() {
    cartOverlay.hidden = false;
    cartDrawer.classList.add("open");
    cartDrawer.setAttribute("aria-hidden", "false");
  }

  function closeCart() {
    cartOverlay.hidden = true;
    cartDrawer.classList.remove("open");
    cartDrawer.setAttribute("aria-hidden", "true");
  }

  if (cartToggle) cartToggle.addEventListener("click", openCart);
  if (cartClose) cartClose.addEventListener("click", closeCart);
  if (cartOverlay) cartOverlay.addEventListener("click", closeCart);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeCart();
  });

  if (cartCheckoutBtn) {
    cartCheckoutBtn.addEventListener("click", function () {
      var items = Object.keys(cart)
        .filter(function (id) { return cart[id] > 0; })
        .map(function (id) { return { id: id, qty: cart[id] }; });

      if (items.length === 0) return;

      cartErrorEl.hidden = true;
      cartCheckoutBtn.disabled = true;
      cartCheckoutBtn.textContent = "Redirecting…";

      fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: items }),
      })
        .then(function (res) {
          return res.text().then(function (text) {
            return { ok: res.ok, data: ChenUtil.safeParseJson(text) };
          });
        })
        .then(function (result) {
          if (result.ok && result.data.url) {
            window.location = result.data.url;
            return;
          }
          throw new Error(result.data.error || "Something went wrong starting checkout.");
        })
        .catch(function (err) {
          cartErrorEl.textContent = err.message;
          cartErrorEl.hidden = false;
          cartCheckoutBtn.disabled = false;
          cartCheckoutBtn.textContent = "Checkout";
        });
    });
  }

  // Handle the redirect back from Stripe Checkout.
  var params = new URLSearchParams(window.location.search);
  if (params.get("checkout") === "success") {
    cart = {};
    saveCart();
    if (checkoutBanner) checkoutBanner.hidden = false;
  }

  fetch("data/products.json")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      products = data;
      // Drop anything left in a saved cart that no longer exists or is over stock.
      cart = ChenCart.sanitizeCart(cart, products);
      saveCart();
      renderProducts();
      renderCart();
    })
    .catch(function () {
      shopGrid.innerHTML = '<p class="shop-loading">Couldn\'t load the shop right now - please refresh.</p>';
    });
})();
