// Cloudflare Pages Function middleware: runs before every request to the
// site - page loads and /api/* calls alike. When the LaunchDarkly
// "maintenance-mode" flag is on, everything gets the static
// maintenance.html page (503) instead of reaching the real site or its
// functions, so a sale can't sneak through while the shop is "down".
//
// Requires an LD_CLIENT_SIDE_ID environment variable (Settings ->
// Environment variables on the Cloudflare Pages project, or .dev.vars
// locally). This is LaunchDarkly's *client-side ID* for the environment
// (Account settings -> Projects), not a secret key - it's meant to be
// public, same as it would be if embedded in a browser. See README.md.

import { isFlagOn } from "./_lib/launchdarkly.js";

const FLAG_KEY = "maintenance-mode";

// The logo maintenance.html itself displays - let it through even while
// the site is "down" so that page isn't stuck with a broken image.
const ALLOWED_DURING_MAINTENANCE = new Set(["/images/logo.png"]);

export async function onRequest(context) {
  const { request, env, next } = context;

  if (ALLOWED_DURING_MAINTENANCE.has(new URL(request.url).pathname)) {
    return next();
  }

  if (!env.LD_CLIENT_SIDE_ID) {
    return next();
  }

  let maintenanceOn = false;
  try {
    maintenanceOn = await isFlagOn(env.LD_CLIENT_SIDE_ID, FLAG_KEY, context);
  } catch (err) {
    // LaunchDarkly unreachable or misconfigured - fail open rather than
    // let a flaky flag check take the whole site down by accident.
    return next();
  }

  if (!maintenanceOn) {
    return next();
  }

  const page = await env.ASSETS.fetch(new URL("/maintenance.html", request.url));
  return new Response(page.body, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=UTF-8", "Retry-After": "300" },
  });
}
