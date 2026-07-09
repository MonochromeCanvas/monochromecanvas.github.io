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
  mailing_list_opt_in?: boolean;
  status?: string;
  created_at?: string;
};

type WebhookPayload = {
  record?: SubmissionRecord;
  old_record?: SubmissionRecord | null;
  type?: string;
  table?: string;
};

type EmailMessage = {
  to: string | string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
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

  let payload: WebhookPayload;

  try {
    payload = await request.json();
  } catch (_error) {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }

  try {
    const result = await handleWebhookPayload(payload);
    return jsonResponse(result);
  } catch (error) {
    if (error instanceof EmailDeliveryError) {
      return jsonResponse({ error: "Resend email failed", details: error.details }, 502);
    }

    console.error(error);
    return jsonResponse({ error: "Notification failed" }, 500);
  }
});

async function handleWebhookPayload(payload: WebhookPayload) {
  const submission = payload.record;
  const previous = payload.old_record || null;
  const operation = String(payload.type || "").toUpperCase();

  if (!submission) {
    return { ok: true, skipped: true, reason: "missing_record" };
  }

  if (operation === "INSERT" && submission.status === "pending") {
    const studioResult = await sendStudioPendingEmail(submission);
    const artistResult = getArtistEmailsEnabled()
      ? await sendArtistReceiptEmail(submission)
      : { skipped: true, reason: "artist_emails_disabled" };

    return { ok: true, event: "pending_submission", studioResult, artistResult };
  }

  const isReviewDecision =
    operation === "UPDATE" &&
    (!previous || previous.status !== submission.status) &&
    (submission.status === "approved" || submission.status === "denied");

  if (isReviewDecision) {
    if (!getArtistEmailsEnabled()) {
      return { ok: true, skipped: true, reason: "artist_emails_disabled" };
    }

    const artistResult = await sendArtistDecisionEmail(submission);
    return { ok: true, event: "artist_decision", artistResult };
  }

  return { ok: true, skipped: true };
}

async function sendStudioPendingEmail(submission: SubmissionRecord) {
  const title = getTitle(submission);
  const subject = `Community Canvas submission pending review: ${title}`;
  const adminUrl = getAdminUrl();
  const imageUrl = getImageUrl(submission.image_path || "");
  const methods = formatMethods(submission);
  const publicCredit = getPublicCredit(submission);

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
        ${row("Mailing list", submission.mailing_list_opt_in ? "Opted in" : "No")}
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
    `Mailing list: ${submission.mailing_list_opt_in ? "Opted in" : "No"}`,
    `Method: ${methods}`,
    `Social: ${submission.social || ""}`,
    `Website: ${submission.website || ""}`,
    `Location: ${submission.location || ""}`,
    `Artwork note: ${submission.artwork_note || ""}`,
    `Monochrome Canvas note: ${submission.endorsement || ""}`,
    imageUrl ? `Submitted image: ${imageUrl}` : "",
    `Review dashboard: ${adminUrl}`
  ].filter(Boolean).join("\n");

  return sendEmail({
    to: getNotifyTo(),
    replyTo: submission.artist_email || undefined,
    subject,
    html,
    text
  });
}

async function sendArtistReceiptEmail(submission: SubmissionRecord) {
  if (!submission.artist_email) {
    return { skipped: true, reason: "missing_artist_email" };
  }

  const title = getTitle(submission);
  const subject = `We received your Recycled Studio Paper Gallery submission`;
  const html = artistShell(`
    <h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:500;margin:0 0 16px;">Submission received</h1>
    <p>Thank you for sharing <strong>${escapeHtml(title)}</strong> with Monochrome Canvas.</p>
    <p>Your artwork has been received for studio review. We review each piece before it appears in the public Recycled Studio Paper Gallery, and you will receive another note when the review is complete.</p>
    <p style="margin-top:20px;"><a href="${escapeAttribute(getGalleryUrl())}" style="color:#11100e;font-weight:700;">Visit the gallery</a></p>
  `);

  const text = [
    "Submission received",
    "",
    `Thank you for sharing ${title} with Monochrome Canvas.`,
    "Your artwork has been received for studio review. We review each piece before it appears in the public Recycled Studio Paper Gallery, and you will receive another note when the review is complete.",
    "",
    `Gallery: ${getGalleryUrl()}`
  ].join("\n");

  return sendEmail({
    to: submission.artist_email,
    replyTo: getPrimaryNotifyTo(),
    subject,
    html,
    text
  });
}

async function sendArtistDecisionEmail(submission: SubmissionRecord) {
  if (!submission.artist_email) {
    return { skipped: true, reason: "missing_artist_email" };
  }

  const title = getTitle(submission);
  const approved = submission.status === "approved";
  const subject = approved
    ? `Your Recycled Studio Paper Gallery submission was approved`
    : `Update on your Recycled Studio Paper Gallery submission`;
  const html = approved ? artistShell(`
    <h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:500;margin:0 0 16px;">Your artwork was approved</h1>
    <p><strong>${escapeHtml(title)}</strong> has been approved for the Recycled Studio Paper Gallery.</p>
    <p>Thank you for creating with our recycled studio paper and sharing your work with the Monochrome Canvas community.</p>
    <p style="margin-top:20px;"><a href="${escapeAttribute(getGalleryUrl())}" style="color:#11100e;font-weight:700;">View the gallery</a></p>
  `) : artistShell(`
    <h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:500;margin:0 0 16px;">Submission review update</h1>
    <p>Thank you for sharing <strong>${escapeHtml(title)}</strong> with Monochrome Canvas.</p>
    <p>We are not able to include this submission in the public gallery. This may happen when an image is unclear, duplicated, not connected to the recycled studio paper, or not the right fit for the public project archive.</p>
    <p>We still appreciate you taking part in the project and creating with the paper.</p>
  `);

  const text = approved ? [
    "Your artwork was approved",
    "",
    `${title} has been approved for the Recycled Studio Paper Gallery.`,
    "Thank you for creating with our recycled studio paper and sharing your work with the Monochrome Canvas community.",
    "",
    `Gallery: ${getGalleryUrl()}`
  ].join("\n") : [
    "Submission review update",
    "",
    `Thank you for sharing ${title} with Monochrome Canvas.`,
    "We are not able to include this submission in the public gallery. This may happen when an image is unclear, duplicated, not connected to the recycled studio paper, or not the right fit for the public project archive.",
    "We still appreciate you taking part in the project and creating with the paper."
  ].join("\n");

  return sendEmail({
    to: submission.artist_email,
    replyTo: getPrimaryNotifyTo(),
    subject,
    html,
    text
  });
}

async function sendEmail(message: EmailMessage) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  if (!resendApiKey) {
    throw new Error("Missing RESEND_API_KEY");
  }

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: getNotifyFrom(),
      to: Array.isArray(message.to) ? message.to : [message.to],
      reply_to: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text
    })
  });

  if (!resendResponse.ok) {
    throw new EmailDeliveryError(await resendResponse.text());
  }

  return await resendResponse.json();
}

class EmailDeliveryError extends Error {
  details: string;

  constructor(details: string) {
    super("Resend email failed");
    this.details = details;
  }
}

function getArtistEmailsEnabled() {
  return Deno.env.get("COMMUNITY_CANVAS_ARTIST_EMAILS_ENABLED") === "true";
}

function getNotifyTo() {
  return (Deno.env.get("COMMUNITY_CANVAS_NOTIFY_TO") || "studio@monochromecanvas.com")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

function getPrimaryNotifyTo() {
  return getNotifyTo()[0] || "studio@monochromecanvas.com";
}

function getNotifyFrom() {
  return Deno.env.get("COMMUNITY_CANVAS_NOTIFY_FROM") || "Community Canvas <notifications@monochromecanvas.com>";
}

function getAdminUrl() {
  return Deno.env.get("COMMUNITY_CANVAS_ADMIN_URL") ||
    "https://monochromecanvas.github.io/community-canvas/admin/";
}

function getGalleryUrl() {
  return Deno.env.get("COMMUNITY_CANVAS_GALLERY_URL") ||
    "https://monochromecanvas.github.io/community-canvas/";
}

function getTitle(submission: SubmissionRecord) {
  return submission.title || "Untitled";
}

function getPublicCredit(submission: SubmissionRecord) {
  return submission.credit_mode === "public"
    ? submission.artist_name || "Public credit selected, no artist name shared"
    : "Anonymous public credit";
}

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

function artistShell(content: string) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#11100e;">
      ${content}
      <p style="border-top:1px solid #d6d0c6;margin-top:28px;padding-top:16px;color:#615f59;">
        Monochrome Canvas<br>
        Recycled Studio Paper Gallery
      </p>
    </div>
  `;
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
