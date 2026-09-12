# Chen Art Co website

A static website for the Chen Art Co embroidery studio, plus a small shop with real checkout and live inventory. No build step, no framework — plain HTML/CSS/JS for the site, with a few small serverless functions (Cloudflare Pages Functions) for Stripe payments, live stock (Cloudflare D1), and custom order emails.

## Before going live

A few placeholders need to be swapped for the real thing:

1. **Contact info** — in `index.html`, search for `Johnc4923@gmail.com` (in the footer, and in `maintenance.html`/`404.html`) and replace with the real, branded email you want live.
2. **Custom order form** — see "Custom order emails" below.
3. **Shop / Stripe** — see the "Accepting payments" section below. Without this set up, the Shop section will show real products but checkout will fail with an error.
4. **Copy** — the "About" section and step-by-step process text are generic placeholders. Swap in real details (turnaround time, pricing if you want to list it, your own story).

## Custom order emails

The Custom Orders form posts to `functions/api/send-order.js`, a Cloudflare Pages Function that emails the submission to you via [Resend](https://resend.com) — no third-party form service needed. Customers can attach up to 5 reference images (6MB each), which are sent as email attachments.

**One-time setup:**

1. Create a free [Resend account](https://resend.com) and grab an API key (Dashboard → API Keys).
2. In your Cloudflare Pages project: **Settings → Environment variables**, add as **Secrets**:
   - `RESEND_API_KEY` — the key from step 1.
   - `SELLER_EMAIL` — the address order requests should land in. Comma-separate multiple addresses (e.g. `a@x.com,b@y.com`) to notify more than one inbox.
3. Redeploy (or it'll pick these up on the next deploy).

By default, emails send `from` Resend's shared `onboarding@resend.dev` address, which can only deliver to the email your Resend account itself is registered with. To send to any `SELLER_EMAIL`, verify a domain in Resend (Dashboard → Domains — this is a DNS step, easy if the domain is already on Cloudflare) and set a `FROM_EMAIL` secret using that domain (e.g. `orders@chenart.co`).

**Testing locally:** add `RESEND_API_KEY`, `SELLER_EMAIL`, and (optionally) `FROM_EMAIL` to `.dev.vars`, then submit the form while running `npm run dev`.

## Accepting payments (the Shop section)

The Shop lets visitors add ready-made pieces to a cart and pay through **Stripe Checkout**. There's no monthly platform fee — you only pay Stripe's standard card-processing fee per sale.

**One-time setup:**

1. Create a [Stripe account](https://dashboard.stripe.com/register) (free).
2. In the Stripe Dashboard, grab your **secret key** (Developers → API keys). Use the **test mode** key first (`sk_test_...`) to try everything end-to-end before going live.
3. In your Cloudflare Pages project: **Settings → Environment variables** → add `STRIPE_SECRET_KEY` as a **Secret**, paste the key in. Do this for both the Production and Preview environments.
4. Redeploy (or it'll pick it up on the next deploy automatically).

That's it — `functions/api/create-checkout-session.js` deploys automatically alongside the rest of the site as a Cloudflare Pages Function; there's nothing separate to host.

**Testing before going live:** with a `sk_test_...` key, use [Stripe's test card numbers](https://docs.stripe.com/testing#cards) (e.g. `4242 4242 4242 4242`, any future expiry, any CVC) to place a real test order end-to-end. Once you're happy, switch to your **live** secret key (`sk_live_...`) in the Cloudflare environment variable and redeploy.

**Shipping:** Checkout collects a shipping address (US only for now) and charges a flat $7.50 rate, set via `SHIPPING_COUNTRY` / `SHIPPING_RATE_CENTS` at the top of `functions/api/create-checkout-session.js`.

**Tax:** Checkout sets `automatic_tax: { enabled: true }`, so Stripe calculates real tax based on the buyer's shipping address. **This requires Stripe Tax to already be enabled in the Dashboard** (Settings → Tax, with an origin address configured) — if you ever disable Stripe Tax there, also remove `automatic_tax` from `create-checkout-session.js`, or every checkout will fail outright.

**Payment methods:** Checkout is intentionally restricted to `payment_method_types: ["card"]`, with `billing_address_collection: "required"`. This is deliberate, not an oversight — an alternative method like Link can complete checkout via a saved one-click profile without a name or shipping address ever being collected, which broke both order emails below. Don't re-enable Link (or other Dashboard-toggleable express/wallet methods) without also re-verifying that a name, email, and shipping address are always present on the resulting session.

**Important:** `payment_method_types: ["card"]` alone does *not* fully suppress Link — a recognized Link user (by email) still gets the "Continue with Link" prompt, a Link express-checkout button, and a "Bank" (Instant Debits via Link) payment tab, all of which can skip the shipping/name form. Link is partly controlled account-wide, independent of a session's `payment_method_types`. To actually turn it off, disable **Link** in the Stripe Dashboard under **Settings → Payment methods** (do this in both test/sandbox and live mode).

**Order emails:** once a payment actually clears, `functions/api/stripe-webhook.js` sends two emails via the same Resend setup as the custom order form (`RESEND_API_KEY`, `SELLER_EMAIL`, `FROM_EMAIL` - see "Custom order emails" above; no extra setup needed if that's already configured):
- **Seller notification** - a plain-text summary (items with thumbnails, quantities, buyer contact, shipping address, total) to `SELLER_EMAIL`.
- **Buyer confirmation** - a branded HTML receipt to whatever email address the buyer entered at Stripe Checkout. Needs only `RESEND_API_KEY` (not `SELLER_EMAIL`) - there's no separate config for the buyer's address.

Item thumbnails and the logo in both emails are embedded inline (fetched server-side and attached via Resend's `content_id`/CID mechanism, not linked to the live site) — this renders correctly under local dev too, where the site's `origin` is `localhost` and unreachable from a real inbox.

The two sends are independent - each is best-effort on its own, so a missing env var or a Resend error on one never blocks checkout, stock accounting, or the other email. Failures are logged to the Cloudflare Function's logs.

**Managing products** — edit `data/products.json`. Each item looks like:

```json
{
  "id": "gold-thread-crewneck",
  "name": "Gold Thread Emblem Crewneck",
  "price": 6800,
  "image": "images/chen-07.jpg",
  "description": "One-of-a-kind gold thread emblem...",
  "stock": 1
}
```

- `price` is in **cents** (6800 = $68.00).
- `id` must be unique and shouldn't change once a product's been live (it's just a slug, letters/numbers/dashes).
- `name`, `price`, `image`, and `description` come from this file.

**`stock` in `products.json` is seed data only — not live.** Live stock (the number that actually decreases when someone buys) lives in a Cloudflare D1 database instead, set up in "Live inventory" below. **Adding a brand-new product touches two places**: an entry here in `products.json` *and* a row in D1 (via `db/seed.sql` or a manual `INSERT`) — a product missing from D1 shows as sold out by default, so don't forget the second step.

**Test-only products.** A product with `"previewOnly": true` (like the built-in `preview-test-item`, a $0.50 item for exercising checkout end-to-end) is hidden from `/api/products` unless `SHOW_TEST_PRODUCTS=true` is set. Set that env var in **Preview** environment variables and in `.dev.vars` for local dev — **never in Production** — so test items never show up for real customers. A product with `"stock": -1` is also exempt from D1 entirely: it always reports unlimited stock and is skipped by the Stripe webhook's decrement step, so purchasing it never touches inventory (see `UNLIMITED_STOCK_PRODUCT_IDS` in `functions/_lib/inventory.js`).

## Live inventory (Cloudflare D1)

Stock now updates automatically when a sale completes, instead of needing a manual edit to `products.json` after every order. A Stripe webhook tells the site the instant a payment finishes (not the buyer's browser redirecting back, which they could skip by closing the tab), which then decrements the real count in a small Cloudflare D1 database.

**One-time setup:**

1. Create the database: `npx wrangler d1 create chen-art-co-inventory` — copy the `database_id` it prints into `wrangler.toml`.
2. Load the schema and starting stock into it: `npx wrangler d1 execute chen-art-co-inventory --remote --file=./db/schema.sql` then `--remote --file=./db/seed.sql`.
3. In the Cloudflare Pages project: **Settings → Functions → D1 database bindings** → add binding name `DB` → select `chen-art-co-inventory`, for both Production and Preview.
4. In the Stripe Dashboard: **Developers → Webhooks → Add endpoint** → URL is your site's `/api/stripe-webhook` (e.g. `https://chenart.co/api/stripe-webhook`) → events to send: `checkout.session.completed` **and** `checkout.session.async_payment_succeeded` (the second one covers delayed payment methods like bank debits, which complete the checkout session before the payment itself actually clears) → copy the signing secret it gives you.
5. Add that secret as `STRIPE_WEBHOOK_SECRET` in **Settings → Environment variables** (Secret, both Production and Preview) — same pattern as `STRIPE_SECRET_KEY`.

**Testing locally:** once `wrangler.toml`'s `[[d1_databases]]` block exists, `npm run dev` auto-provisions a local D1 (no cloud credentials needed) — see "Running it locally" below for the one-time local schema/seed step. Stripe can't deliver webhooks to `localhost` directly, so `npm run dev` also runs `stripe listen --forward-to localhost:8788/api/stripe-webhook` alongside wrangler (via `concurrently`) — install the [Stripe CLI](https://docs.stripe.com/stripe-cli) and run `stripe login` once first. The first time, copy the webhook signing secret `stripe listen` prints (`Ready! Your webhook signing secret is whsec_...`) into `.dev.vars` as `STRIPE_WEBHOOK_SECRET` and restart `npm run dev` — it's stable for this Stripe account, so this is a one-time step, not a per-run one. Then either place a real test-mode order through checkout, or run `stripe trigger checkout.session.completed` in another terminal.

## Maintenance mode (LaunchDarkly)

The whole site (pages *and* the Shop's API - checkout, order form, everything) can be switched to a "down for maintenance" page from a single toggle, without a deploy. It's driven by a feature flag in [LaunchDarkly](https://launchdarkly.com), checked on every request by `functions/_middleware.js`.

**One-time setup:**

1. Create a free [LaunchDarkly account](https://launchdarkly.com) and a project.
2. In that project, create a **boolean flag** with the key `maintenance-mode` (defaulting to **off**).
3. Grab the environment's **client-side ID** (Account settings → Projects → your environment). This is *not* a secret key - it's the same ID that would be safe to embed in a browser, so it can go in as a plain environment variable rather than a Secret.
4. In your Cloudflare Pages project: **Settings → Environment variables** → add `LD_CLIENT_SIDE_ID` (Production and Preview) with that ID.
5. Redeploy (or it'll pick it up on the next deploy).

To take the site down: flip `maintenance-mode` to **on** in the LaunchDarkly dashboard - takes effect within ~20 seconds (how long a check is cached for), no redeploy needed. Flip it back off to bring the site back.

If `LD_CLIENT_SIDE_ID` isn't set, or LaunchDarkly can't be reached, the site behaves as if the flag is off (fails open) - a LaunchDarkly outage should never accidentally take the site down.

**Testing locally:** add `LD_CLIENT_SIDE_ID` to `.dev.vars`, run `npm run dev`, then toggle the flag in the LaunchDarkly dashboard and reload.

## Editing content

Everything is in `index.html` — it's one page split into sections (`Hero`, `Shop`, `Work`/gallery, `Process`, `Custom Orders`, `About`, `Footer`). To add a new photo to the gallery:

1. Drop the image into `images/` (see "Adding new photos or videos" below for format tips).
2. Copy one of the existing `<button class="gallery-item">...</button>` blocks in the `#work` section and update the `src`, `data-full`, and `alt` text.

To add a video, copy one of the `data-type="video"` gallery items and update `data-full` (the `.mp4` path) and `data-poster` (a still image shown before it plays).

To add/edit/remove shop products, see "Accepting payments" above — it's all in `data/products.json`, no HTML editing needed.

## Adding new photos or videos

Phones export photos as `.HEIC` and videos as `.MOV`, which most browsers can't display. Convert them first:

- **Photos**: open in Preview (Mac) or Photos (Windows) and "Export as JPEG", or use an online HEIC→JPG converter.
- **Videos**: use an online `.MOV` → `.MP4` converter, or ask whoever set this up to run it through `ffmpeg`.

Keep images under ~2000px wide so the site stays fast — most photo editors and export tools have a "resize" option.

## Running it locally

The Shop section fetches `/api/products` at load time, which needs a real local server (not a plain `file://` open of `index.html`, which will show "Couldn't load the shop" — everything else on the page still works fine that way). To see the Shop (and test checkout) locally, run:

```
npm.cmd run dev
```

This runs Cloudflare's local dev tool (`wrangler pages dev .`), which serves the site and emulates the Pages Functions. For the checkout button to actually complete, add a `.dev.vars` file in the project root with `STRIPE_SECRET_KEY=sk_test_...` (a test-mode key from your Stripe dashboard).

**One-time local database setup** (needed for `/api/products` and checkout to return real stock instead of a 500 — see "Live inventory" above):
```
npx wrangler d1 execute chen-art-co-inventory --local --file=./db/schema.sql
npx wrangler d1 execute chen-art-co-inventory --local --file=./db/seed.sql
```
This creates a local SQLite-backed database under `.wrangler/` — no cloud credentials needed.

## Running tests

The cart/pricing logic and the Stripe checkout function have a unit test suite (Node's built-in test runner, plus `jsdom` for the tests that need a real DOM). One-time setup:

```
npm.cmd install
```

Then, any time you want to check your changes:

```
npm.cmd test
```

Tests also run automatically on GitHub via Actions on every push and pull request.

Coverage can be checked with:

```
npm.cmd run test:coverage
```

## Local integration tests

`npm test` above uses fakes/stubs for everything external (Stripe, Resend, LaunchDarkly, D1). There's a separate, **local-only** integration suite that instead drives a real `wrangler pages dev` process and makes real calls with whatever is in your `.dev.vars`:

```
npm.cmd run test:integration
```

**This sends real emails and creates real Stripe objects on every run:**
- A real Stripe **test-mode** Checkout Session is created (via `STRIPE_SECRET_KEY`).
- A real seller-notification email AND a real buyer-confirmation email are sent via Resend to the addresses in `SELLER_EMAIL` (via a hand-signed webhook event using `STRIPE_WEBHOOK_SECRET` - no `stripe listen`/Stripe CLI needed).
- A real "custom order" email is sent via Resend to `SELLER_EMAIL`.

All of these are clearly prefixed `[Integration Test]` in the subject/name so they're easy to spot and ignore in your inbox, and only touch the unlimited-stock `preview-test-item` product, so real seeded inventory is never decremented.

Requires `.dev.vars` to have `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, and `SELLER_EMAIL` set (see the setup sections above) - the script fails fast with a clear message if any are missing. It also runs the one-time local D1 schema/seed step automatically if it hasn't been done yet (see "Running it locally" above), and starts its own `wrangler pages dev` on port 8799 so it won't collide with one you already have running on 8788.

Run this manually and occasionally - it's **not** part of `npm test` and does **not** run in CI, specifically because of the real side effects above.

## Real-browser tests (Playwright)

The suites above run in Node/jsdom - they can't catch real CSS/layout issues, accessibility problems, or visual regressions (e.g. text overlapping a light part of a background photo on mobile). A [Playwright](https://playwright.dev) layer covers that, split into two projects:

```
npm.cmd run test:e2e
```

Runs the **`ci`** project (`tests/e2e/`) against a local `wrangler pages dev` + local D1 - no real Stripe/Resend secrets needed (same as the free local-D1 step above). Covers a cart smoke test, an automated accessibility scan ([axe-core](https://www.deque.com/axe/)) at mobile/desktop breakpoints, and visual-regression screenshots of the hero section at a few widths. This is the one that runs in CI on every push/PR (on `windows-latest`, to match the committed screenshot baselines in `tests/e2e/**/*-snapshots/` - Playwright's visual snapshots are platform-specific).

```
npm.cmd run test:e2e:local
```

Runs the **`local`** project (`tests/e2e-local/`) - the same "real side effects" philosophy as `test:integration`: it actually clicks Checkout and confirms the browser lands on a real Stripe Checkout page. Requires `STRIPE_SECRET_KEY` in `.dev.vars`. Manual/occasional only, never in CI.

One-time setup (in addition to `npm install`): `npx playwright install chromium`.

If you intentionally change the hero's markup/CSS, regenerate the visual baselines with `npx playwright test --project=ci --update-snapshots` (with `test:e2e`'s server already running) and commit the updated PNGs.

## Deploying for free

This site needs a host that supports **serverless functions** (for the Shop's checkout), not just static files:

- **Cloudflare Pages** (recommended, since you're already on Cloudflare) — connect the GitHub repo in the dashboard, leave the build command empty and output directory as `/`. `functions/api/*` deploys automatically as Pages Functions.
- **Netlify** also works but needs the function rewritten in Netlify's function format (different folder/API shape) — not a drop-in swap.
- **GitHub Pages** does *not* support serverless functions — the rest of the site would work, but the Shop's checkout would not.

Add your custom domain (e.g. `chenart.co`) as a "Custom domain" on the Pages project once it's deployed.

## Structure

```
index.html                              the whole site
css/style.css                           styles (brand colors are defined at the top as CSS variables)
js/main.js                              mobile menu, gallery lightbox, custom-order form submission
js/shop.js                              product rendering, cart, and checkout wiring for the Shop section
js/cart.js                              pure cart/pricing logic used by shop.js (unit tested)
js/util.js                              small shared helpers (e.g. safe JSON parsing)
data/products.json                      product catalog: name/price/image/description (stock is seed-only - see Live inventory)
wrangler.toml                           Cloudflare config - declares the D1 database binding
db/schema.sql                           D1 table definitions (live stock + processed webhook events)
db/seed.sql                             starting stock values, loaded into D1 once
functions/_lib/inventory.js             shared helper: merges products.json with live D1 stock
functions/_lib/launchdarkly.js          shared helper: checks a LaunchDarkly flag, cached briefly
functions/_middleware.js                runs on every request; serves maintenance.html when the flag is on
functions/api/products.js               Cloudflare Pages Function: GET /api/products (catalog + live stock)
functions/api/create-checkout-session.js  Cloudflare Pages Function that creates the Stripe Checkout session
functions/api/stripe-webhook.js         Cloudflare Pages Function that decrements D1 stock on a completed sale
maintenance.html                        static "down for maintenance" page, served by functions/_middleware.js
404.html                                static "page not found" page - Cloudflare Pages serves this automatically (with a real 404 status) for unmatched routes
tests/                                  unit tests (run with `npm test`)
tests/integration/                      local-only integration tests (run with `npm run test:integration` - see "Local integration tests" above)
tests/e2e/                              CI-safe Playwright tests (run with `npm run test:e2e` - see "Real-browser tests" above)
tests/e2e-local/                        local-only real-Stripe Playwright test (run with `npm run test:e2e:local`)
playwright.config.js                    defines the `ci`/`local` Playwright projects above
scripts/run-integration-tests.js        drives the local integration suite: starts wrangler pages dev + local D1, then runs tests/integration/
scripts/run-e2e-tests.js                drives the Playwright suites: starts wrangler pages dev + local D1, then runs the matching project
scripts/lib/localServer.js              shared wrangler-pages-dev + local-D1 startup/teardown logic used by both scripts above
images/                                  photos, video posters, and favicon
videos/                                  video clips used in the gallery and Process section
```
