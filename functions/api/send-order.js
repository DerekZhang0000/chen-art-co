// Cloudflare Pages Function: POST /api/send-order
//
// Receives the custom-order form submission and emails it to the seller
// via Resend, instead of relying on a third-party form service.
//
// Requires these set as environment variables/secrets on the Cloudflare
// Pages project (and in .dev.vars locally) - see README.md:
//   RESEND_API_KEY  - from resend.com
//   SELLER_EMAIL    - where order requests get sent; comma-separate to
//                     notify multiple addresses (e.g. "a@x.com,b@y.com")
//   FROM_EMAIL      - optional; the Resend "from" address. Without a
//                     verified domain in Resend, the default
//                     onboarding@resend.dev sender only works if
//                     SELLER_EMAIL is the address your Resend account
//                     itself is registered with.

const MAX_REFERENCE_IMAGES = 5;
const MAX_REFERENCE_IMAGE_BYTES = 6 * 1024 * 1024;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.RESEND_API_KEY || !env.SELLER_EMAIL) {
    return jsonResponse({ error: "The order form isn't configured yet." }, 500);
  }

  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return jsonResponse({ error: "Invalid form submission." }, 400);
  }

  const name = (form.get("name") || "").toString().trim();
  const email = (form.get("email") || "").toString().trim();
  const garment = (form.get("garment") || "").toString().trim();
  const idea = (form.get("idea") || "").toString().trim();
  const timeline = (form.get("timeline") || "").toString().trim();
  const budget = (form.get("budget") || "").toString().trim();
  const referenceImages = form.getAll("referenceImages").filter((f) => f instanceof File && f.size > 0);

  if (!name || !email || !garment || !idea) {
    return jsonResponse({ error: "Please fill in all required fields." }, 400);
  }

  if (referenceImages.length > MAX_REFERENCE_IMAGES) {
    return jsonResponse({ error: `Please attach up to ${MAX_REFERENCE_IMAGES} images.` }, 400);
  }
  if (referenceImages.some((f) => f.size > MAX_REFERENCE_IMAGE_BYTES)) {
    return jsonResponse({ error: "Each image must be 6MB or smaller." }, 400);
  }
  if (referenceImages.some((f) => !f.type.startsWith("image/"))) {
    return jsonResponse({ error: "Reference attachments must be images." }, 400);
  }

  const fromEmail = env.FROM_EMAIL || "onboarding@resend.dev";
  const sellerEmails = env.SELLER_EMAIL.split(",").map((s) => s.trim()).filter(Boolean);

  const lines = [
    `Name: ${name}`,
    `Email: ${email}`,
    `Garment: ${garment}`,
    `Idea: ${idea}`,
    `Timeline: ${timeline || "(not specified)"}`,
    `Budget: ${budget || "(not specified)"}`,
    `Reference images: ${referenceImages.length ? `${referenceImages.length} attached` : "(none)"}`,
  ];

  const attachments = await Promise.all(
    referenceImages.map(async (file) => ({
      // A File with a genuinely empty name doesn't survive a real multipart
      // Request/formData() roundtrip as a File at all (it's dropped by the
      // `instanceof File` filter above), so this fallback can't be exercised
      // through the real upload path - kept as a defensive default anyway.
      /* node:coverage ignore next */
      filename: file.name || "reference-image",
      content: await fileToBase64(file),
    }))
  );

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: sellerEmails,
      reply_to: email,
      subject: `Custom order request from ${name}`,
      text: lines.join("\n"),
      ...(attachments.length ? { attachments } : {}),
    }),
  });

  if (!resendRes.ok) {
    const errorBody = await resendRes.json().catch(() => ({}));
    return jsonResponse({ error: errorBody.message || "Couldn't send the request. Please email us directly." }, 502);
  }

  return jsonResponse({ ok: true });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
