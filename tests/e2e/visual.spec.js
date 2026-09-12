// Visual regression for the hero section at a few fixed viewport widths -
// exactly the "text now overlaps a light region of the image" style
// regression noted in QA-Report-2026-09-11.md, which a jsdom test
// structurally can't see. A generous diff ratio absorbs normal
// cross-platform font/anti-aliasing differences without masking a real
// layout change.
const { test, expect } = require("@playwright/test");

const WIDTHS = [375, 768, 1280];

for (const width of WIDTHS) {
  test(`hero section renders correctly at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator(".hero")).toHaveScreenshot(`hero-${width}.png`, {
      maxDiffPixelRatio: 0.02,
    });
  });
}
