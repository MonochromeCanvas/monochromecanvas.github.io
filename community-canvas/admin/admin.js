(function () {
  const communityCanvas = window.communityCanvas;

  const elements = {
    setupPanel: document.getElementById("setupPanel"),
    loginPanel: document.getElementById("loginPanel"),
    loginForm: document.getElementById("loginForm"),
    adminEmailInput: document.getElementById("adminEmailInput"),
    loginStatus: document.getElementById("loginStatus"),
    reviewPanel: document.getElementById("reviewPanel"),
    reviewTitle: document.getElementById("reviewTitle"),
    statusFilter: document.getElementById("statusFilter"),
    refreshButton: document.getElementById("refreshButton"),
    signOutButton: document.getElementById("signOutButton"),
    adminStatus: document.getElementById("adminStatus"),
    submissionList: document.getElementById("submissionList")
  };

  let supabase = null;
  let session = null;
  let submissionsRequestId = 0;

  init();

  async function init() {
    if (!communityCanvas || !communityCanvas.isConfigured()) {
      elements.setupPanel.hidden = false;
      return;
    }

    supabase = communityCanvas.getClient();

    if (!supabase) {
      elements.setupPanel.hidden = false;
      return;
    }

    bindEvents();

    const sessionResult = await supabase.auth.getSession();
    session = sessionResult.data && sessionResult.data.session ? sessionResult.data.session : null;

    supabase.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      renderAuthState();
    });

    await renderAuthState();
  }

  function bindEvents() {
    elements.loginForm.addEventListener("submit", handleLogin);
    elements.statusFilter.addEventListener("change", loadSubmissions);
    elements.refreshButton.addEventListener("click", loadSubmissions);
    elements.signOutButton.addEventListener("click", () => supabase.auth.signOut());
  }

  async function renderAuthState() {
    elements.loginPanel.hidden = Boolean(session);
    elements.reviewPanel.hidden = !session;

    if (!session) {
      return;
    }

    const isAdmin = await checkAdminAccess();

    if (!isAdmin) {
      await supabase.auth.signOut();
      elements.reviewPanel.hidden = true;
      elements.loginPanel.hidden = false;
      setLoginStatus("This email is not approved for studio review access.", "error");
      return;
    }

    await loadSubmissions();
  }

  async function handleLogin(event) {
    event.preventDefault();
    const email = cleanText(elements.adminEmailInput.value).toLowerCase();

    if (!email) {
      setLoginStatus("Enter your studio email address.", "error");
      return;
    }

    setLoginStatus("Sending sign-in link...", "");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: getAdminRedirectUrl(),
        shouldCreateUser: true
      }
    });

    if (error) {
      console.error(error);
      setLoginStatus(getAuthErrorMessage(error), "error");
      return;
    }

    setLoginStatus("Check your email for a Supabase sign-in link.", "success");
  }

  async function checkAdminAccess() {
    const { data, error } = await supabase.rpc("community_canvas_is_admin");

    if (error) {
      console.error(error);
      return false;
    }

    return Boolean(data);
  }

  async function loadSubmissions() {
    const requestId = ++submissionsRequestId;
    const status = elements.statusFilter.value;
    setAdminStatus("Loading submissions...", "");
    elements.submissionList.replaceChildren();
    elements.reviewTitle.textContent = status === "all" ? "All submissions" : capitalize(status) + " submissions";

    let query = supabase
      .from("community_canvas_submissions")
      .select("*")
      .order("created_at", { ascending: false });

    if (status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (requestId !== submissionsRequestId) {
      return;
    }

    if (error) {
      console.error(error);
      setAdminStatus("Could not load submissions. Check the SQL policies and admin email.", "error");
      return;
    }

    const submissions = Array.isArray(data) ? data : [];
    setAdminStatus(submissions.length ? "" : "No submissions in this view yet.", "");
    elements.submissionList.replaceChildren(...submissions.map(createSubmissionCard));
  }

  function createSubmissionCard(submission) {
    const card = document.createElement("article");
    card.className = "admin-card";

    const image = document.createElement("div");
    image.className = "admin-card-image";
    image.style.backgroundImage = 'url("' + communityCanvas.getPublicArtworkUrl(submission.image_path).replace(/"/g, "%22") + '")';

    const body = document.createElement("div");
    body.className = "admin-card-body";

    const title = document.createElement("h3");
    title.textContent = submission.title || "Untitled";

    const meta = document.createElement("dl");
    meta.className = "admin-meta";
    addMeta(meta, "Status", submission.status);
    addMeta(meta, "Email", submission.artist_email);
    addMeta(meta, "Credit", getCreditLine(submission));
    addMeta(meta, "Paper confirmed", submission.paper_confirmed ? "Yes" : "No");
    addMeta(meta, "Method", getMethodLine(submission));
    addMeta(meta, "Social", submission.social);
    addMeta(meta, "Website", submission.website);
    addMeta(meta, "Location", submission.location);
    addMeta(meta, "Submitted", formatDate(submission.created_at));

    const notes = document.createElement("div");
    notes.className = "admin-notes";
    appendNote(notes, "Artwork note", submission.artwork_note);
    appendNote(notes, "Monochrome Canvas note", submission.endorsement);

    const adminNotes = document.createElement("label");
    adminNotes.className = "field";
    adminNotes.innerHTML = "<span>Private admin notes</span>";
    const notesInput = document.createElement("textarea");
    notesInput.rows = 3;
    notesInput.value = submission.admin_notes || "";
    adminNotes.appendChild(notesInput);

    const actions = document.createElement("div");
    actions.className = "admin-card-actions";
    actions.append(
      createActionButton("Approve", () => updateSubmission(submission.id, { status: "approved" })),
      createActionButton("Deny", () => updateSubmission(submission.id, { status: "denied", featured: false })),
      createActionButton(submission.featured ? "Unfeature" : "Feature", () =>
        updateSubmission(submission.id, { featured: !submission.featured, status: "approved" })
      ),
      createActionButton("Save notes", () => updateSubmission(submission.id, { admin_notes: notesInput.value })),
      createActionButton("Delete", () => deleteSubmission(submission), "danger-button")
    );

    body.append(title, meta, notes, adminNotes, actions);
    card.append(image, body);
    return card;
  }

  async function updateSubmission(id, changes) {
    setAdminStatus("Saving...", "");
    const userEmail = session && session.user && session.user.email ? session.user.email : "";
    const payload = {
      ...changes,
      reviewed_at: new Date().toISOString(),
      reviewed_by: userEmail
    };

    const { error } = await supabase
      .from("community_canvas_submissions")
      .update(payload)
      .eq("id", id);

    if (error) {
      console.error(error);
      setAdminStatus("Could not save that review action.", "error");
      return;
    }

    setAdminStatus("Saved.", "success");
    await loadSubmissions();
  }

  async function deleteSubmission(submission) {
    const confirmed = window.confirm(
      "Delete this submission permanently? This removes the review record and stored image. This cannot be undone."
    );

    if (!confirmed) {
      return;
    }

    setAdminStatus("Deleting submission...", "");

    const storageResult = await supabase.storage.from(communityCanvas.getBucketName()).remove([submission.image_path]);

    if (storageResult.error) {
      console.error(storageResult.error);
      setAdminStatus("Could not delete the stored image. The submission was not deleted.", "error");
      return;
    }

    const deleteResult = await supabase
      .from("community_canvas_submissions")
      .delete()
      .eq("id", submission.id);

    if (deleteResult.error) {
      console.error(deleteResult.error);
      setAdminStatus("Could not delete that submission.", "error");
      return;
    }

    setAdminStatus("Submission deleted.", "success");
    await loadSubmissions();
  }

  function createActionButton(label, onClick, extraClass) {
    const button = document.createElement("button");
    button.className = "button ghost-button" + (extraClass ? " " + extraClass : "");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function addMeta(list, label, value) {
    if (!value) {
      return;
    }

    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    list.append(dt, dd);
  }

  function appendNote(container, label, value) {
    if (!value) {
      return;
    }

    const note = document.createElement("p");
    note.innerHTML = "<strong></strong> <span></span>";
    note.querySelector("strong").textContent = label + ":";
    note.querySelector("span").textContent = value;
    container.appendChild(note);
  }

  function getCreditLine(submission) {
    if (submission.credit_mode !== "public") {
      return "Anonymous";
    }

    return submission.artist_name || "Public credit selected, no artist name shared";
  }

  function getMethodLine(submission) {
    const methods = Array.isArray(submission.artwork_methods) ? submission.artwork_methods : [];
    const labels = methods.map(formatMethodLabel);

    if (submission.artwork_method_other) {
      labels.push("Other: " + submission.artwork_method_other);
    }

    return labels.join(", ");
  }

  function formatMethodLabel(value) {
    if (value === "mixed-media") {
      return "Mixed media";
    }

    return capitalize(value);
  }

  function getAuthErrorMessage(error) {
    const code = String(error && (error.code || error.error_code || error.status) ? error.code || error.error_code || error.status : "");
    const message = String(error && error.message ? error.message : "");

    if (code === "over_email_send_rate_limit" || code === "429" || /rate limit/i.test(message)) {
      return "Supabase is temporarily rate-limiting sign-in emails. Please wait about an hour and try again.";
    }

    if (/redirect/i.test(message)) {
      return "Supabase rejected the admin redirect URL. I updated the page to use the clean admin URL; refresh and try again.";
    }

    if (message) {
      return "Could not send the sign-in link: " + message;
    }

    return "Could not send the sign-in link. Check the email address or try again in a few minutes.";
  }

  function getAdminRedirectUrl() {
    const redirectUrl = new URL(window.location.href);
    redirectUrl.search = "";
    redirectUrl.hash = "";
    return redirectUrl.toString();
  }

  function setLoginStatus(message, tone) {
    setStatus(elements.loginStatus, message, tone);
  }

  function setAdminStatus(message, tone) {
    setStatus(elements.adminStatus, message, tone);
  }

  function setStatus(element, message, tone) {
    element.textContent = message;
    element.classList.toggle("is-error", tone === "error");
    element.classList.toggle("is-success", tone === "success");
  }

  function cleanText(value) {
    return communityCanvas && communityCanvas.cleanText
      ? communityCanvas.cleanText(value)
      : String(value || "").replace(/\s+/g, " ").trim();
  }

  function capitalize(value) {
    return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }

    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  }
})();
