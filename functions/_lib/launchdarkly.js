// Checks a LaunchDarkly boolean flag from a Cloudflare Pages Function.
//
// This deliberately calls the same flag-evaluation endpoint the browser
// JS SDK polls (via plain fetch) instead of installing LaunchDarkly's
// server-side SDK - this project has no build step, and pulling in a
// bundler-oriented npm package just for one global on/off switch would
// break that. LaunchDarkly's servers still do the real evaluation
// (targeting rules, percentage rollouts); this only reads the result for
// an anonymous, untargeted context, which is all a site-wide maintenance
// switch needs.
//
// Result is cached for CACHE_SECONDS via the Cache API so a burst of
// traffic doesn't turn into a burst of calls to LaunchDarkly.

const CACHE_SECONDS = 20;

export async function isFlagOn(clientSideId, flagKey, context) {
  // `caches` is a Workers/Pages-only global - absent under the plain
  // Node test runner this project's other tests use, so caching is
  // skipped there rather than every test needing to stub it.
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`https://ld-flag-cache.internal/${clientSideId}/${flagKey}`);

  const cached = cache && (await cache.match(cacheKey));
  if (cached) {
    const { value } = await cached.json();
    return value === true;
  }

  const anonContext = { kind: "user", key: "anonymous-site-visitor", anonymous: true };
  const encodedContext = base64UrlEncode(JSON.stringify(anonContext));

  const res = await fetch(
    `https://clientsdk.launchdarkly.com/sdk/evalx/${clientSideId}/contexts/${encodedContext}`
  );
  if (!res.ok) {
    throw new Error(`LaunchDarkly flag check failed with status ${res.status}`);
  }

  const flags = await res.json();
  const value = flags?.[flagKey]?.value === true;

  if (cache) {
    const cacheResponse = new Response(JSON.stringify({ value }), {
      headers: { "Cache-Control": `max-age=${CACHE_SECONDS}`, "Content-Type": "application/json" },
    });
    context.waitUntil(cache.put(cacheKey, cacheResponse));
  }

  return value;
}

function base64UrlEncode(str) {
  const base64 = btoa(unescape(encodeURIComponent(str)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
