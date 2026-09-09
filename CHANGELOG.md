# Changelog

## 2026-09-08 — Shipping Collection & Order Notification Emails

- Checkout now collects a shipping address (US only for now) and charges a flat $7.50 shipping rate via Stripe's `shipping_address_collection`/`shipping_options`. An order made up entirely of unlimited-stock items (e.g. the $0.50 preview test item) gets free shipping instead, since there's nothing real to ship.
- Once a payment actually clears, the seller now gets an order-notification email (items, quantities, prices, buyer contact, shipping address, and total) via the same Resend setup as the custom order form. Best-effort: a missing config or Resend failure never blocks checkout or stock accounting.
- Expanded test coverage for checkout and webhook logic, including the new shipping params, free-shipping rule, and notification email (153 tests passing).

## 2026-09-08 — Reference Image Attachments & Preview Test Item

- Custom order form: visitors can now attach up to 5 reference images (6MB each) directly in the form instead of emailing them separately afterward; images are sent as attachments via Resend, with matching client- and server-side validation.
- Fixed a layout bug where a form validation message appearing would reflow the Custom Orders section, visibly shifting the zoom/crop of the decorative Dr. Beer background photo.
- Shop: added a $0.50 test item (`preview-test-item`) with unlimited stock for exercising checkout end-to-end without touching real inventory. Hidden from Production behind a `SHOW_TEST_PRODUCTS` environment variable (Preview/local only) and never decremented by the Stripe webhook.
- Fixed: that unlimited-stock item would incorrectly fail checkout with "just sold out" despite showing as available in the shop.
- Removed a stray em dash from the order-confirmation message.
- Expanded test coverage across cart, shop, products API, checkout, and webhook tests (144 tests passing).

## 2026-09-07 — Gallery, Custom Orders, and Intro Content Refresh

- Work gallery: replaced the blurred grad stole photo with a new mid-stitch shot, and swapped the Dr. Beer photo for a new Ohio Gozaimasu Tee crop (now labeled with a caption).
- Custom Orders section now features the Dr. Beer Tee photo (previously Ohio Gozaimasu Tee), shown uncropped.
- "What we do" video replaced with new embroidery-machine footage of the mech shirt design; adjusted that section's image/video box to a taller aspect ratio so less of the (portrait-shot) footage gets cropped.
- Tab title simplified to "Chen Art Co." site-wide (was "Chen Art Co. - Custom Embroidery"), including the maintenance page and social-preview title.
- The maintenance page now keeps the site's favicon instead of a blank tab icon.

## 2026-09-07 — LaunchDarkly Maintenance Mode

- Added a "down for maintenance" mode driven by a LaunchDarkly feature flag (`maintenance-mode`): flipping it takes the whole site — pages and the Shop's API alike — down to a branded maintenance page within seconds, no deploy needed.
- New `functions/_middleware.js` checks the flag on every request; fails open (site stays up) if LaunchDarkly isn't configured or unreachable.
- New branded `maintenance.html` page (logo, Instagram handle, contact info).
- Documented one-time LaunchDarkly + Cloudflare setup in `README.md`.

## 2026-09-06 — Live Inventory, New Shop Items, and Site Content Refresh

- Live inventory: stock now updates automatically via a Stripe webhook + Cloudflare D1 database instead of manual edits to `data/products.json`.
- Replaced the 3 placeholder shop products with 8 new one-of-a-kind pieces.
- Added new photos and videos across the Hero, About, Process, and Custom Orders sections, and 16 new (shuffled) photos in the Work gallery.
- General polish pass: button colors, section backgrounds, marquee animation, image cropping/positioning, and spacing throughout.
- Added `scripts/process_assets.py` for converting and renaming raw photos/videos before adding them to the site.
- Expanded test coverage for the webhook, live inventory endpoint, and checkout logic.

## 2026-09-06 — Test Coverage Update

- Added unit tests for the custom order email function (`tests/send-order.test.js`): missing config, malformed form body, missing required fields, multi-seller sending, custom `FROM_EMAIL`, and Resend error handling.
- Added a test asserting the checkout-success URL param is cleared, not just that the cart/banner update.
- Stripe checkout already had full test coverage (`tests/create-checkout-session.test.js`) — no gaps found there.

## 2026-09-06 — Custom Order Email Setup

- Custom order form now emails you directly via a Cloudflare Pages Function + Resend (`functions/api/send-order.js`), replacing Formspree.
- Branding: "Chen Art Co" → "Chen Art Co." site-wide.
- Hero video blur increased (7px → 12px).
- Local dev (`npm run dev`) now runs `wrangler pages dev .` instead of `live-server` — this also serves the Pages Functions locally (Stripe checkout, order emails). Removed `live-server` dependency.
- Fixed: checkout success banner reappearing after a page refresh (URL's `?checkout=success` param wasn't being cleared).
- Removed derekzhang0000@gmail.com from the footer contact list.

## 2026-09-04 — UI Update

- Moved the nav's call-to-action styling from Contact to Shop, with a rainbow gradient hover effect.
- Instagram icon recolored with the brand's gradient.
- Added a second contact email to the footer.

## 2026-09-04 — General Update

- Added the Shop section: product cart, checkout flow, and the Stripe Checkout Pages Function (`functions/api/create-checkout-session.js`).
- Added the product catalog (`data/products.json`).
- Added the unit test suite (cart logic, checkout function, DOM behavior) and a GitHub Actions CI workflow.

## 2026-09-03 — Initial commit

- Initial Chen Art Co embroidery studio website.
