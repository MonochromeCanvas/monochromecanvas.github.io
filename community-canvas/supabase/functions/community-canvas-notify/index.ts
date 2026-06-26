type SubmissionRecord = {
  id?: string;
  title?: string;
  artist_email?: string;
  artist_name?: string | null;
  credit_mode?: string;
  social?: string | null;
  website?: string | null;
  location?: string | null;
  artwork_note?: string | null;
  endorsement?: string | null;
  image_path?: string;
  artwork_methods?: string[];
  artwork_method_other?: string | null;
  status?: string;
  created_at?: string;
};

type WebhookPayload = {
  record?: SubmissionRecord;
  type?: string;
  table?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-community-canvas-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const expectedSecret = Deno.env.get("COMMUNITY_CANVAS_WEBHOOK_SECRET");

  if (!expectedSecret) {
    return jsonResponse({ error: "Missing COMMUNITY_CANVAS_WEBHOOK_SECRET" }, 500);
  }

  if (request.headers.get("x-community-canvas-secret") !== expectedSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const notifyTo = Deno.env.get("COMMUNITY_CANVAS_NOTIFY_TO") || "studio@monochromecanvas.com";
  const notifyFrom = Deno.env.get("COMMUNITY_CANVAS_NOTIFY_FROM") || "Community Canvas <notifications@monochromecanvas.com>";

  if (!resendApiKey) {
    return jsonResponse({ error: "Missing RESEND_API_KEY" }, 500);
  }

  let payload: WebhookPayload;

  try {
    payload = await request.json();
  } catch (_error) {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }

  const submission = payload.record;

  if (!submission || submission.status !== "pending") {
    return jsonResponse({ ok: true, skipped: true });
  }

  const title = submission.title || "Untitled";
  const subject = `Community Canvas submission pending review: ${title}`;
  const adminUrl = Deno.env.get("COMMUNITY_CANVAS_ADMIN_URL") ||
    "https://monochromecanvas.github.io/community-canvas/admin/";
  const imageUrl = getImageUrl(submission.image_path || "");
  const methods = formatMethods(submission);
  const publicCredit = submission.credit_mode === "public"
    ? submission.artist_name || "Public credit selected, no artist name shared"
    : "Anonymous public credit";

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#11100e;">
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:500;margin:0 0 16px;">
        New Community Canvas submission
      </h1>
      <p>A new artwork is pending review for the Recycled Studio Paper Gallery.</p>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0;width:100%;max-width:620px;">
        ${row("Title", title)}
        ${row("Public credit", publicCredit)}
        ${row("Private email", submission.artist_email || "")}
        ${row("Method", methods)}
        ${row("Social", submission.social || "")}
        ${row("Website", submission.website || "")}
        ${row("Location", submission.location || "")}
        ${row("Artwork note", submission.artwork_note || "")}
        ${row("Monochrome Canvas note", submission.endorsement || "")}
      </table>
      ${imageUrl ? `<p><a href="${escapeAttribute(imageUrl)}">Open submitted image</a></p>` : ""}
      <p><a href="${escapeAttribute(adminUrl)}" style="color:#11100e;font-weight:700;">Open the review dashboard</a></p>
    </div>
  `;

  const text = [
    "New Community Canvas submission",
    "",
    "A new artwork is pending review for the Recycled Studio Paper Gallery.",
    "",
    `Title: ${title}`,
    `Public credit: ${publicCredit}`,
    `Private email: ${submission.artist_email || ""}`,
    `Method: ${methods}`,
    `Social: ${submission.social || ""}`,
    `Website: ${submission.website || ""}`,
    `Location: ${submission.location || ""}`,
    `Artwork note: ${submission.artwork_note || ""}`,
    `Monochrome Canvas note: ${submission.endorsement || ""}`,
    imageUrl ? `Submitted image: ${imageUrl}` : "",
    `Review dashboard: ${adminUrl}`
  ].filter(Boolean).join("\n");

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: notifyFrom,
      to: notifyTo.split(",").map((email) => email.trim()).filter(Boolean),
      reply_to: submission.artist_email || undefined,
      subject,
      html,
      text
    })
  });

  if (!resendResponse.ok) {
    const details = await resendResponse.text();
    return jsonResponse({ error: "Resend email failed", details }, 502);
  }

  const result = await resendResponse.json();
  return jsonResponse({ ok: true, result });
});

function getImageUrl(imagePath: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const bucket = Deno.env.get("COMMUNITY_CANVAS_BUCKET") || "community-canvas-artwork";

  if (!supabaseUrl || !imagePath) {
    return "";
  }

  const encodedPath = imagePath.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${encodedPath}`;
}

function formatMethods(submission: SubmissionRecord) {
  const labels = Array.isArray(submission.artwork_methods)
    ? submission.artwork_methods.map((method) => method === "mixed-media" ? "Mixed media" : capitalize(method))
    : [];

  if (submission.artwork_method_other) {
    labels.push(`Other: ${submission.artwork_method_other}`);
  }

  return labels.join(", ") || "Not shared";
}

function row(label: string, value: string) {
  if (!value) {
    return "";
  }

  return `
    <tr>
      <th align="left" style="border-top:1px solid #d6d0c6;padding:10px 12px 10px 0;vertical-align:top;width:150px;">
        ${escapeHtml(label)}
      </th>
      <td style="border-top:1px solid #d6d0c6;padding:10px 0;vertical-align:top;">
        ${escapeHtml(value)}
      </td>
    </tr>
  `;
}

function capitalize(value: string) {
  const clean = String(value || "").replace(/-/g, " ");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
