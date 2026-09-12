// Local-only real-browser test: adds the unlimited-stock preview test item
// to the cart, clicks Checkout, and confirms the browser actually lands on
// a real Stripe-hosted Checkout page with the right line item. Requires a
// real STRIPE_SECRET_KEY (from .dev.vars) and creates a real Stripe
// test-mode Checkout Session - run via `npm run test:e2e:local`, never in
// CI. See tests/e2e/smoke.spec.js for the CI-safe cart-only equivalent.
const { test, expect } = require("@playwright/test");

test("checkout with the preview test item reaches a real Stripe Checkout page", async ({ page }) => {
  await page.goto("/");

  const previewCard = page.locator(".product-card", { hasText: "Test Item" });
  await previewCard.locator(".product-add").click();

  await expect(page.locator("#cart-drawer")).toHaveClass(/open/);
  await page.locator("#cart-checkout").click();

  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
  await expect(page.getByText("Test Item (Preview Only)")).toBeVisible();
});
