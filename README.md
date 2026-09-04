# Chen Art Co website

A simple, static website for the Chen Art Co embroidery studio. No build step, no framework, no server required — it's plain HTML/CSS/JS, so it's free to host and easy to edit.

## Before going live

A few placeholders need to be swapped for the real thing:

1. **Contact info** — in `index.html`, search for `hello@chenartco.com` and `@chenart.co` (in the footer) and replace with the real email and Instagram handle.
2. **Custom order form** — the form on the page posts to [Formspree](https://formspree.io), a free service that emails you form submissions without needing a backend.
   - Create a free Formspree account and a new form.
   - Copy the endpoint it gives you (looks like `https://formspree.io/f/abcd1234`).
   - In `index.html`, find `action="https://formspree.io/f/YOUR_FORM_ID"` and replace `YOUR_FORM_ID` with your real ID.
   - Free tier covers 50 submissions/month, which is plenty to start.
3. **Copy** — the "About" section and step-by-step process text are generic placeholders. Swap in real details (turnaround time, pricing if you want to list it, your own story).

## Editing content

Everything is in `index.html` — it's one page split into sections (`Hero`, `Work`/gallery, `Process`, `Custom Orders`, `About`, `Footer`). To add a new photo to the gallery:

1. Drop the image into `images/` (see "Adding new photos or videos" below for format tips).
2. Copy one of the existing `<button class="gallery-item">...</button>` blocks in the `#work` section and update the `src`, `data-full`, and `alt` text.

To add a video, copy one of the `data-type="video"` gallery items and update `data-full` (the `.mp4` path) and `data-poster` (a still image shown before it plays).

## Adding new photos or videos

Phones export photos as `.HEIC` and videos as `.MOV`, which most browsers can't display. Convert them first:

- **Photos**: open in Preview (Mac) or Photos (Windows) and "Export as JPEG", or use an online HEIC→JPG converter.
- **Videos**: use an online `.MOV` → `.MP4` converter, or ask whoever set this up to run it through `ffmpeg`.

Keep images under ~2000px wide so the site stays fast — most photo editors and export tools have a "resize" option.

## Running it locally

No install needed. Just open `index.html` in a browser, or for a closer-to-production preview, run a tiny local server from this folder:

```
npx serve .
```

then visit the URL it prints.

## Deploying for free

This site is plain static files, so any free static host works. Easiest options:

- **Cloudflare Pages** or **Netlify** — drag-and-drop this whole folder in their dashboard, or connect a GitHub repo for automatic deploys on every change.
- **GitHub Pages** — push this folder to a GitHub repo and enable Pages in the repo settings.

Any of these will give you a free `*.pages.dev` / `*.netlify.app` / `*.github.io` URL. To use a real domain (e.g. `chenartco.com`), buy one from a registrar (Cloudflare Registrar and Namecheap sell at/near cost, ~$12/year) and point it at whichever host you chose — each has a short "custom domain" guide in their dashboard.

## Structure

```
index.html        the whole site
css/style.css      styles (brand colors are defined at the top as CSS variables)
js/main.js         mobile menu, gallery lightbox, form submission
images/            photos, video posters, and favicon
videos/            video clips used in the gallery and Process section
```
