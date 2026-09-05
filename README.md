# Chen Art Co website

A static website for the Chen Art Co embroidery studio, plus a small shop with real checkout. No build step, no framework — plain HTML/CSS/JS for the site, with one tiny serverless function (Cloudflare Pages Function) to talk to Stripe for payments.

## Before going live

A few placeholders need to be swapped for the real thing:

1. **Contact info** — in `index.html`, search for `hello@chenartco.com` (in the footer) and replace with the real email.
2. **Custom order form** — the form on the page posts to [Formspree](https://formspree.io), a free service that emails you form submissions without needing a backend.
   - Create a free Formspree account and a new form.
   - Copy the endpoint it gives you (looks like `https://formspree.io/f/abcd1234`).
   - In `index.html`, find `action="https://formspree.io/f/YOUR_FORM_ID"` and replace `YOUR_FORM_ID` with your real ID.
   - Free tier covers 50 submissions/month, which is plenty to start.
3. **Shop / Stripe** — see the "Accepting payments" section below. Without this set up, the Shop section will show real products but checkout will fail with an error.
4. **Copy** — the "About" section and step-by-step process text are generic placeholders. Swap in real details (turnaround time, pricing if you want to list it, your own story).

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
- Add a new product by copying an entry; remove one by deleting its entry (or set `"stock": 0` to keep it visible-but-sold-out... actually sold-out items still render with a disabled "Sold out" button, so either approach works).

**⚠️ Important limitation — no live inventory sync.** These are one-of-a-kind or small-batch pieces, and the site has no database — `stock` in `products.json` is the *only* source of truth, and it doesn't decrease automatically when someone buys. **After every sale, manually lower (or zero out) that product's `stock` and redeploy** — otherwise the same one-of-a-kind item could be sold to two people. For low order volume this manual step is genuinely fine; just make it a habit to check `products.json` against the Stripe Dashboard's order list before a piece could be bought twice.

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

The Shop section fetches `data/products.json` at load time, which browsers block over a plain `file://` URL — so opening `index.html` directly will show "Couldn't load the shop" (everything else on the page works fine that way). To see the Shop locally, run a real local server from this folder:

```
npm.cmd run dev
```

(one-time setup: `npm.cmd install`, same as below) then visit the URL it prints — this uses `live-server`, so the browser auto-refreshes whenever you save a file. Note that the **checkout button** still won't complete locally unless you're also running Cloudflare's local dev tool (`npx wrangler pages dev .`, which emulates the Pages Function and reads a local `.dev.vars` file for `STRIPE_SECRET_KEY`) — for everyday content edits, `npm run dev` is enough.

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
data/products.json                      the shop's product catalog (edit this to add/remove/reprice items)
functions/api/create-checkout-session.js  Cloudflare Pages Function that creates the Stripe Checkout session
tests/                                  unit tests (run with `npm test`)
images/                                  photos, video posters, and favicon
videos/                                  video clips used in the gallery and Process section
```
