(function () {
  const HEART_STORE_KEY = "mc-community-canvas-hearts-v2";
  const communityCanvas = window.communityCanvas;

  const elements = {
    galleryGrid: document.getElementById("galleryGrid"),
    sortSelect: document.getElementById("sortSelect"),
    archiveCount: document.getElementById("archiveCount"),
    dialog: document.getElementById("artworkDialog"),
    closeDialog: document.getElementById("closeDialog"),
    dialogImage: document.getElementById("dialogImage"),
    dialogKicker: document.getElementById("dialogKicker"),
    dialogTitle: document.getElementById("dialogTitle"),
    dialogArtist: document.getElementById("dialogArtist"),
    dialogNotes: document.getElementById("dialogNotes"),
    dialogHeart: document.getElementById("dialogHeart")
  };

  const state = {
    approved: [],
    selectedArtwork: null
  };

  init();

  async function init() {
    bindEvents();
    await loadApprovedSubmissions();
    renderGallery();
  }

  function bindEvents() {
    elements.sortSelect.addEventListener("change", renderGallery);
    elements.closeDialog.addEventListener("click", closeDialog);
    elements.dialog.addEventListener("click", (event) => {
      if (event.target === elements.dialog) {
        closeDialog();
      }
    });
    elements.dialogHeart.addEventListener("click", () => {
      if (state.selectedArtwork) {
        toggleHeart(state.selectedArtwork.id);
      }
    });
  }

  async function loadApprovedSubmissions() {
    const supabase = communityCanvas && communityCanvas.getClient();

    if (!supabase) {
      state.approved = [];
      return;
    }

    try {
      const { data, error } = await supabase
        .from("community_canvas_public_gallery")
        .select(
          "id, created_at, title, artist_name, credit_mode, social, website, location, artwork_note, image_path, heart_count, featured, display_order"
        )
        .order("featured", { ascending: false })
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      state.approved = normalizeSubmissions(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      state.approved = [];
    }
  }

  function renderGallery() {
    const sorted = sortSubmissions(state.approved, elements.sortSelect.value);
    elements.galleryGrid.replaceChildren();
    elements.archiveCount.textContent = sorted.length ? "Showing " + sorted.length + " pieces." : "";

    if (!sorted.length) {
      return;
    }

    sorted.forEach((submission) => {
      elements.galleryGrid.appendChild(createGalleryCard(submission));
    });
  }

  function sortSubmissions(items, sortMode) {
    const sorted = items.slice();

    if (sortMode === "newest") {
      return sorted.sort(newestSort);
    }

    if (sortMode === "random") {
      return sorted.sort(() => Math.random() - 0.5);
    }

    return sorted.sort(
      (a, b) =>
        Number(b.featured) - Number(a.featured) ||
        Number(a.displayOrder) - Number(b.displayOrder) ||
        newestSort(a, b)
    );
  }

  function newestSort(a, b) {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }

  function createGalleryCard(submission) {
    const article = document.createElement("article");
    article.className = "gallery-card";

    const imageButton = document.createElement("button");
    imageButton.className = "gallery-art-button";
    imageButton.type = "button";
    imageButton.setAttribute("aria-label", "Open details for " + submission.title);
    imageButton.addEventListener("click", () => openArtwork(submission.id));

    const image = document.createElement("div");
    image.className = "gallery-image";
    image.style.setProperty("--art-ratio", submission.aspectRatio || "4 / 5");
    setBackgroundImage(image, submission.imageUrl);
    imageButton.appendChild(image);

    const body = document.createElement("div");
    body.className = "gallery-body";

    const titleRow = document.createElement("div");
    titleRow.className = "gallery-title-row";

    const title = document.createElement("h3");
    title.textContent = submission.title || "Untitled";
    titleRow.appendChild(title);

    if (submission.featured) {
      const featured = document.createElement("span");
      featured.className = "featured-tag";
      featured.textContent = "Featured";
      titleRow.appendChild(featured);
    }

    const meta = document.createElement("p");
    meta.className = "gallery-meta";
    meta.textContent = getPublicArtistName(submission);

    const actions = document.createElement("div");
    actions.className = "gallery-actions";

    const heart = createHeartButton(submission);
    const details = document.createElement("button");
    details.className = "view-details";
    details.type = "button";
    details.textContent = "View details";
    details.addEventListener("click", () => openArtwork(submission.id));

    actions.append(heart, details);
    body.append(titleRow, meta, actions);
    article.append(imageButton, body);

    return article;
  }

  function openArtwork(id) {
    const submission = state.approved.find((item) => item.id === id);

    if (!submission) {
      return;
    }

    state.selectedArtwork = submission;
    renderDialog(submission);

    if (typeof elements.dialog.showModal === "function") {
      elements.dialog.showModal();
    } else {
      elements.dialog.setAttribute("open", "open");
    }
  }

  function renderDialog(submission) {
    setBackgroundImage(elements.dialogImage, submission.imageUrl);
    elements.dialogKicker.textContent = submission.featured ? "Featured submission" : "Gallery submission";
    elements.dialogTitle.textContent = submission.title || "Untitled";
    elements.dialogArtist.textContent = getPublicArtistName(submission);
    elements.dialogNotes.replaceChildren();

    if (submission.social || submission.website || submission.location) {
      const publicInfo = document.createElement("p");
      publicInfo.textContent = [submission.social, submission.website, submission.location].filter(Boolean).join(" | ");
      elements.dialogNotes.appendChild(publicInfo);
    }

    if (submission.artworkNote) {
      const note = document.createElement("p");
      note.textContent = submission.artworkNote;
      elements.dialogNotes.appendChild(note);
    }

    updateHeartButton(elements.dialogHeart, submission);
  }

  function closeDialog() {
    if (typeof elements.dialog.close === "function") {
      elements.dialog.close();
    } else {
      elements.dialog.removeAttribute("open");
    }
  }

  function createHeartButton(submission) {
    const button = document.createElement("button");
    button.className = "heart-button";
    button.type = "button";
    button.addEventListener("click", () => toggleHeart(submission.id));
    updateHeartButton(button, submission);
    return button;
  }

  function updateHeartButton(button, submission) {
    const liked = getLikedSet().has(submission.id);
    button.classList.toggle("is-liked", liked);
    button.setAttribute("aria-pressed", liked ? "true" : "false");
    button.textContent = (liked ? "Hearted " : "Heart ") + getHeartCount(submission);
  }

  async function toggleHeart(id) {
    const likedSet = getLikedSet();

    if (likedSet.has(id)) {
      likedSet.delete(id);
    } else {
      likedSet.add(id);
    }

    localStorage.setItem(HEART_STORE_KEY, JSON.stringify(Array.from(likedSet)));

    if (likedSet.has(id)) {
      await incrementHeart(id);
    }

    renderGallery();

    if (state.selectedArtwork && state.selectedArtwork.id === id) {
      renderDialog(state.selectedArtwork);
    }
  }

  async function incrementHeart(id) {
    const supabase = communityCanvas && communityCanvas.getClient();

    if (!supabase) {
      return;
    }

    const { data, error } = await supabase.rpc("community_canvas_increment_heart", {
      submission_id: id
    });

    if (error) {
      console.error(error);
      return;
    }

    const submission = state.approved.find((item) => item.id === id);

    if (submission && typeof data === "number") {
      submission.heartCount = data - 1;
    }
  }

  function getHeartCount(submission) {
    return Number(submission.heartCount || 0) + (getLikedSet().has(submission.id) ? 1 : 0);
  }

  function getLikedSet() {
    try {
      return new Set(JSON.parse(localStorage.getItem(HEART_STORE_KEY) || "[]"));
    } catch (error) {
      return new Set();
    }
  }

  function getPublicArtistName(submission) {
    if (submission.creditMode !== "public") {
      return "Anonymous artist";
    }

    return submission.artistName || "Artist info not shared";
  }

  function normalizeSubmissions(items) {
    return items.map((item, index) => ({
      id: String(item.id || "submission-" + index),
      title: cleanText(item.title) || "Untitled",
      artistName: cleanText(item.artist_name || item.artistName || item.artist || ""),
      creditMode: item.credit_mode === "public" || item.creditMode === "public" ? "public" : "anonymous",
      social: cleanText(item.social || item.socialHandle || ""),
      website: cleanText(item.website || item.portfolio || ""),
      location: cleanText(item.location || ""),
      artworkNote: cleanText(item.artwork_note || item.artworkNote || item.note || ""),
      imageUrl: getImageUrl(item),
      heartCount: Number(item.heart_count || item.heartCount || item.hearts || 0),
      featured: Boolean(item.featured),
      displayOrder: Number(item.display_order || item.displayOrder || 0),
      aspectRatio: cleanText(item.aspect_ratio || item.aspectRatio || ""),
      createdAt: item.created_at || item.createdAt || new Date().toISOString()
    }));
  }

  function getImageUrl(item) {
    if (item.imageUrl || item.image) {
      return String(item.imageUrl || item.image);
    }

    return communityCanvas && communityCanvas.getPublicArtworkUrl
      ? communityCanvas.getPublicArtworkUrl(item.image_path || item.imagePath)
      : "";
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function setBackgroundImage(element, imageUrl) {
    if (!imageUrl) {
      element.style.backgroundImage = "";
      return;
    }

    element.style.backgroundImage = 'url("' + String(imageUrl).replace(/"/g, "%22") + '")';
  }
})();
