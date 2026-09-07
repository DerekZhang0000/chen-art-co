# Chen Art Co website

A static website for the Chen Art Co embroidery studio, plus a small shop with real checkout and live inventory. No build step, no framework — plain HTML/CSS/JS for the site, with a few small serverless functions (Cloudflare Pages Functions) for Stripe payments, live stock (Cloudflare D1), and custom order emails.

## Before going live

A few placeholders need to be swapped for the real thing:

1. **Contact info** — in `index.html`, search for `hello@chenartco.com` (in the footer) and replace with the real email.
2. **Custom order form** — see "Custom order emails" below.
3. **Shop / Stripe** — see the "Accepting payments" section below. Without this set up, the Shop section will show real products but checkout will fail with an error.
4. **Copy** — the "About" section and step-by-step process text are generic placeholders. Swap in real details (turnaround time, pricing if you want to list it, your own story).

## Custom order emails

The Custom Orders form posts to `functions/api/send-order.js`, a Cloudflare Pages Function that emails the submission to you via [Resend](https://resend.com) — no third-party form service needed.

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

## Live inventory (Cloudflare D1)

Stock now updates automatically when a sale completes, instead of needing a manual edit to `products.json` after every order. A Stripe webhook tells the site the instant a payment finishes (not the buyer's browser redirecting back, which they could skip by closing the tab), which then decrements the real count in a small Cloudflare D1 database.

**One-time setup:**

1. Create the database: `npx wrangler d1 create chen-art-co-inventory` — copy the `database_id` it prints into `wrangler.toml`.
2. Load the schema and starting stock into it: `npx wrangler d1 execute chen-art-co-inventory --remote --file=./db/schema.sql` then `--remote --file=./db/seed.sql`.
3. In the Cloudflare Pages project: **Settings → Functions → D1 database bindings** → add binding name `DB` → select `chen-art-co-inventory`, for both Production and Preview.
4. In the Stripe Dashboard: **Developers → Webhooks → Add endpoint** → URL is your site's `/api/stripe-webhook` (e.g. `https://chenart.co/api/stripe-webhook`) → events to send: `checkout.session.completed` **and** `checkout.session.async_payment_succeeded` (the second one covers delayed payment methods like bank debits, which complete the checkout session before the payment itself actually clears) → copy the signing secret it gives you.
5. Add that secret as `STRIPE_WEBHOOK_SECRET` in **Settings → Environment variables** (Secret, both Production and Preview) — same pattern as `STRIPE_SECRET_KEY`.

**Testing locally:** once `wrangler.toml`'s `[[d1_databases]]` block exists, `npm run dev` auto-provisions a local D1 (no cloud credentials needed) — see "Running it locally" below for the one-time local schema/seed step. To test the webhook itself, install the [Stripe CLI](https://docs.stripe.com/stripe-cli), run `stripe listen --forward-to localhost:8788/api/stripe-webhook` (copy the local webhook secret it prints into `.dev.vars` as `STRIPE_WEBHOOK_SECRET`), then `stripe trigger checkout.session.completed`.

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
tests/                                  unit tests (run with `npm test`)
images/                                  photos, video posters, and favicon
videos/                                  video clips used in the gallery and Process section
```
