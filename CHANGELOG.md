# Changelog

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
