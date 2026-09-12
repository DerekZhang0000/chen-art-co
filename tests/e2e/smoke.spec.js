// Real-browser smoke test: homepage loads, a seeded in-stock product can
// be added to the cart, and the drawer reflects it. Stops short of
// clicking Checkout - that needs a real STRIPE_SECRET_KEY, see
// tests/e2e-local/checkout.spec.js. No real third-party calls here.
const { test, expect } = require("@playwright/test");

test("homepage loads and adding a product to the cart opens the drawer with updated totals", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#shop-grid .product-card").first()).toBeVisible();

  const addButton = page.locator(".product-add:not([disabled])").first();
  await addButton.click();

  await expect(page.locator("#cart-drawer")).toHaveClass(/open/);
  await expect(page.locator("#cart-count")).toHaveText("1");
  await expect(page.locator("#cart-subtotal")).not.toHaveText("$0.00");
  await expect(page.locator("#cart-checkout")).toBeEnabled();
});
