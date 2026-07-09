(function () {
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const communityCanvas = window.communityCanvas;

  const elements = {
    form: document.getElementById("submissionForm"),
    fileInput: document.getElementById("artworkFile"),
    emailInput: document.getElementById("emailInput"),
    paperConfirmInput: document.getElementById("paperConfirmInput"),
    methodInputs: Array.from(document.querySelectorAll('input[name="artworkMethod"]')),
    otherMethodInput: document.getElementById("otherMethodInput"),
    mailingListInput: document.getElementById("mailingListInput"),
    consentInput: document.getElementById("consentInput"),
    previewImage: document.getElementById("previewImage"),
    previewText: document.getElementById("previewText"),
    formStatus: document.getElementById("formStatus"),
    fallbackStatus: document.getElementById("fallbackStatus"),
    fallbackEmailLink: document.getElementById("fallbackEmailLink"),
    submitButton: document.getElementById("submitButton"),
    nicknameInput: document.getElementById("nicknameInput")
  };

  bindEvents();
  updateConfiguredState();

  function bindEvents() {
    elements.fileInput.addEventListener("change", handleFileChange);
    elements.form.addEventListener("submit", handleSubmit);
    elements.methodInputs.forEach((input) => input.addEventListener("change", updateOtherMethodState));
    updateOtherMethodState();
  }

  function updateConfiguredState() {
    if (communityCanvas && communityCanvas.isConfigured()) {
      return;
    }

    elements.submitButton.disabled = true;
    setStatus("The online upload is being connected. Please use the email fallback below.", "error");
    showEmailFallback();
  }

  function handleFileChange() {
    const file = elements.fileInput.files && elements.fileInput.files[0];

    if (!file) {
      updatePreview("", "Your uploaded image preview will appear here.");
      return;
    }

    if (!file.type.startsWith("image/")) {
      elements.fileInput.value = "";
      updatePreview("", "Please choose a JPG, PNG, or WebP image.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      elements.fileInput.value = "";
      updatePreview("", "Please choose an image under 10 MB.");
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      updatePreview(String(reader.result || ""), file.name + " selected.");
    });
    reader.readAsDataURL(file);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (elements.nicknameInput && elements.nicknameInput.value) {
      setStatus("Thank you. Your submission has been received for review.", "success");
      elements.form.reset();
      updatePreview("", "Your uploaded image preview will appear here.");
      return;
    }

    const supabase = communityCanvas && communityCanvas.getClient();

    if (!supabase) {
      setStatus("The online upload is being connected. Please use the email fallback below.", "error");
      showEmailFallback();
      return;
    }

    const file = elements.fileInput.files && elements.fileInput.files[0];

    if (!file) {
      setStatus("Please upload a photo of the artwork.", "error");
      elements.fileInput.focus();
      return;
    }

    if (!elements.emailInput.validity.valid) {
      setStatus("Please enter a valid email address.", "error");
      elements.emailInput.focus();
      return;
    }

    if (!elements.paperConfirmInput.checked) {
      setStatus("Please confirm the artwork uses the recycled studio paper.", "error");
      elements.paperConfirmInput.focus();
      return;
    }

    const selectedMethods = getSelectedMethods();

    if (!selectedMethods.length) {
      setStatus("Please choose how the recycled paper was used.", "error");
      elements.methodInputs[0].focus();
      return;
    }

    if (selectedMethods.includes("other") && !cleanText(elements.otherMethodInput.value)) {
      setStatus("Please briefly explain the other way the recycled paper was used.", "error");
      elements.otherMethodInput.focus();
      return;
    }

    if (!elements.consentInput.checked) {
      setStatus("Please confirm the permission and credit statement before submitting.", "error");
      elements.consentInput.focus();
      return;
    }

    setBusy(true);
    setStatus("Uploading your artwork for studio review...", "");

    try {
      const submissionId = crypto.randomUUID();
      const extension = communityCanvas.getFileExtension(file);
      const imagePath = "pending/" + submissionId + "." + extension;

      const uploadResult = await supabase.storage
        .from(communityCanvas.getBucketName())
        .upload(imagePath, file, {
          cacheControl: "3600",
          contentType: file.type,
          upsert: false
        });

      if (uploadResult.error) {
        throw uploadResult.error;
      }

      const payload = buildSubmissionPayload(submissionId, imagePath, file);
      const insertResult = await supabase.from("community_canvas_submissions").insert(payload);

      if (insertResult.error) {
        throw insertResult.error;
      }

      elements.form.reset();
      updatePreview("", "Your uploaded image preview will appear here.");
      setStatus("Thank you. Your artwork has been sent to Monochrome Canvas for review.", "success");
    } catch (error) {
      console.error(error);
      setStatus("Something did not go through. Please use the email fallback below.", "error");
      showEmailFallback();
    } finally {
      setBusy(false);
    }
  }

  function buildSubmissionPayload(submissionId, imagePath, file) {
    const formData = new FormData(elements.form);
    const title = cleanText(formData.get("title")) || "Untitled";

    return {
      id: submissionId,
      status: "pending",
      featured: false,
      title,
      artist_email: cleanText(formData.get("email")).toLowerCase(),
      credit_mode: formData.get("creditMode") === "public" ? "public" : "anonymous",
      artist_name: cleanText(formData.get("artistName")),
      social: cleanText(formData.get("social")),
      website: cleanText(formData.get("website")),
      location: cleanText(formData.get("location")),
      artwork_note: cleanText(formData.get("artworkNote")),
      endorsement: cleanText(formData.get("endorsement")),
      image_path: imagePath,
      image_mime_type: file.type,
      image_size: file.size,
      paper_confirmed: elements.paperConfirmInput.checked,
      artwork_methods: getSelectedMethods(),
      artwork_method_other: cleanText(formData.get("artworkMethodOther")),
      mailing_list_opt_in: Boolean(elements.mailingListInput && elements.mailingListInput.checked),
      permission_confirmed: elements.consentInput.checked,
      source_url: window.location.href,
      user_agent: navigator.userAgent
    };
  }

  function getSelectedMethods() {
    return elements.methodInputs.filter((input) => input.checked).map((input) => input.value);
  }

  function updateOtherMethodState() {
    const isOtherSelected = getSelectedMethods().includes("other");
    elements.otherMethodInput.disabled = !isOtherSelected;

    if (!isOtherSelected) {
      elements.otherMethodInput.value = "";
    }
  }

  function updatePreview(imageUrl, message) {
    elements.previewImage.style.backgroundImage = imageUrl ? 'url("' + imageUrl.replace(/"/g, "%22") + '")' : "";
    elements.previewText.textContent = message;
  }

  function setStatus(message, tone) {
    elements.formStatus.textContent = message;
    elements.formStatus.classList.toggle("is-error", tone === "error");
    elements.formStatus.classList.toggle("is-success", tone === "success");

    if (tone !== "error" && elements.fallbackStatus) {
      elements.fallbackStatus.hidden = true;
    }
  }

  function setBusy(isBusy) {
    elements.submitButton.disabled = isBusy;
    elements.submitButton.textContent = isBusy ? "Sending..." : "Submit for review";
  }

  function showEmailFallback() {
    if (!elements.fallbackStatus || !elements.fallbackEmailLink) {
      return;
    }

    elements.fallbackEmailLink.href = buildFallbackEmailHref();
    elements.fallbackStatus.hidden = false;
  }

  function buildFallbackEmailHref() {
    const formData = new FormData(elements.form);
    const file = elements.fileInput.files && elements.fileInput.files[0];
    const selectedMethods = getSelectedMethods();
    const methodLine = selectedMethods.length ? selectedMethods.join(", ") : "";
    const body = [
      "Hello Monochrome Canvas,",
      "",
      "I would like to submit artwork for the Recycled Studio Paper Gallery.",
      "",
      "Please attach the artwork photo to this email before sending.",
      file ? "Selected file name: " + file.name : "Selected file name:",
      "",
      "Artwork title: " + (cleanText(formData.get("title")) || "Untitled"),
      "Artist email: " + cleanText(formData.get("email")),
      "Public credit: " + (formData.get("creditMode") === "public" ? "Publish artist info" : "Publish anonymously"),
      "Artist/display name: " + cleanText(formData.get("artistName")),
      "Social handle: " + cleanText(formData.get("social")),
      "Website or portfolio: " + cleanText(formData.get("website")),
      "Location or connection: " + cleanText(formData.get("location")),
      "Paper use: " + methodLine,
      "Other paper use: " + cleanText(formData.get("artworkMethodOther")),
      "Mailing list opt-in: " + (formData.get("mailingListOptIn") ? "Yes" : "No"),
      "",
      "Note about the artwork:",
      cleanText(formData.get("artworkNote")),
      "",
      "Monochrome Canvas note:",
      cleanText(formData.get("endorsement")),
      "",
      "I confirm this artwork was made using Monochrome Canvas recycled studio paper and I have permission to submit it."
    ].join("\n");

    return "mailto:studio@monochromecanvas.com?subject=" +
      encodeURIComponent("Recycled Studio Paper Gallery submission") +
      "&body=" +
      encodeURIComponent(body);
  }

  function cleanText(value) {
    return communityCanvas && communityCanvas.cleanText
      ? communityCanvas.cleanText(value)
      : String(value || "").replace(/\s+/g, " ").trim();
  }
})();
