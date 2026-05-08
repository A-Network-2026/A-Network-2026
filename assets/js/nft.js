"use strict";

(function initNftStudio() {
  const els = {
    apiBaseUrl: document.getElementById("api-base-url"),
    apiStatus: document.getElementById("api-status"),
    saveApiBtn: document.getElementById("save-api-btn"),
    testApiBtn: document.getElementById("test-api-btn"),

    profileUid: document.getElementById("profile-uid"),
    profileUsername: document.getElementById("profile-username"),
    profileWallet: document.getElementById("profile-wallet"),
    profileAntsBalance: document.getElementById("profile-ants-balance"),
    profileDisplayName: document.getElementById("profile-display-name"),
    profileBio: document.getElementById("profile-bio"),
    profileAvatar: document.getElementById("profile-avatar"),
    profileBanner: document.getElementById("profile-banner"),
    profileTheme: document.getElementById("profile-theme"),
    profileSaveBtn: document.getElementById("profile-save-btn"),
    profileLoadBtn: document.getElementById("profile-load-btn"),
    profileStatus: document.getElementById("profile-status"),
    profilePreviewJson: document.getElementById("profile-preview-json"),

    assetUid: document.getElementById("asset-uid"),
    assetAntsBalance: document.getElementById("asset-ants-balance"),
    assetName: document.getElementById("asset-name"),
    assetSlug: document.getElementById("asset-slug"),
    assetDescription: document.getElementById("asset-description"),
    assetImage: document.getElementById("asset-image"),
    assetMetadata: document.getElementById("asset-metadata"),
    assetTraits: document.getElementById("asset-traits"),
    assetAntsStake: document.getElementById("asset-ants-stake"),
    assetStatus: document.getElementById("asset-status"),
    assetCreateBtn: document.getElementById("asset-create-btn"),
    assetLoadBtn: document.getElementById("asset-load-btn"),
    assetStatusBox: document.getElementById("asset-status-box"),
    assetList: document.getElementById("asset-list"),

    feedRefreshBtn: document.getElementById("feed-refresh-btn"),
    feedList: document.getElementById("feed-list"),

    kpiMinAnts: document.getElementById("kpi-min-ants"),
    kpiFeedCount: document.getElementById("kpi-feed-count"),
    kpiMyAssets: document.getElementById("kpi-my-assets")
  };

  const state = {
    apiBase: resolveInitialApiBase(),
    minAnts: 1000,
    myAssets: []
  };

  if (els.apiBaseUrl) {
    els.apiBaseUrl.value = state.apiBase;
  }

  wireEvents();
  bootstrap();

  function wireEvents() {
    els.saveApiBtn?.addEventListener("click", onSaveApiBase);
    els.testApiBtn?.addEventListener("click", onTestApi);
    els.profileSaveBtn?.addEventListener("click", onSaveProfile);
    els.profileLoadBtn?.addEventListener("click", onLoadProfile);
    els.assetCreateBtn?.addEventListener("click", onCreateAsset);
    els.assetLoadBtn?.addEventListener("click", onLoadAssets);
    els.feedRefreshBtn?.addEventListener("click", onLoadFeed);
  }

  async function bootstrap() {
    await onTestApi();
    await onLoadFeed();
  }

  function resolveInitialApiBase() {
    const saved = String(localStorage.getItem("anet_nft_api_base") || "").trim();
    if (saved) {
      return saved;
    }

    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      return "http://localhost:3001";
    }

    return window.location.origin;
  }

  function setStatus(el, type, message) {
    if (!el) return;
    el.className = `status ${type}`;
    el.textContent = message;
  }

  function getApiBase() {
    const value = String(els.apiBaseUrl?.value || state.apiBase || "").trim().replace(/\/$/, "");
    return value;
  }

  function saveApiBase(base) {
    state.apiBase = base;
    localStorage.setItem("anet_nft_api_base", base);
    if (els.apiBaseUrl) {
      els.apiBaseUrl.value = base;
    }
  }

  async function apiFetch(path, options = {}) {
    const base = getApiBase();
    if (!base) {
      throw new Error("API base URL is required.");
    }

    const response = await fetch(`${base}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `Request failed (${response.status})`);
    }

    return payload;
  }

  function tryParseJson(value, fallback) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function normalizeUid(value) {
    return String(value || "").trim();
  }

  function toNumberOrZero(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }

  function safeStringify(obj) {
    return JSON.stringify(obj, null, 2);
  }

  function syncUidAcrossForms(uid) {
    if (!uid) return;
    if (els.profileUid) els.profileUid.value = uid;
    if (els.assetUid) els.assetUid.value = uid;
  }

  function syncAntsAcrossForms(ants) {
    const clean = String(toNumberOrZero(ants));
    if (els.profileAntsBalance) els.profileAntsBalance.value = clean;
    if (els.assetAntsBalance) els.assetAntsBalance.value = clean;
  }

  function renderProfile(profile) {
    if (!profile) {
      if (els.profilePreviewJson) {
        els.profilePreviewJson.textContent = "No profile loaded yet.";
      }
      return;
    }

    syncUidAcrossForms(profile.uid);
    syncAntsAcrossForms(profile.antsBalance);

    if (els.profileUsername) els.profileUsername.value = profile.username || "";
    if (els.profileWallet) els.profileWallet.value = profile.walletAddress || "";
    if (els.profileDisplayName) els.profileDisplayName.value = profile.displayName || "";
    if (els.profileBio) els.profileBio.value = profile.bio || "";
    if (els.profileAvatar) els.profileAvatar.value = profile.avatarUri || "";
    if (els.profileBanner) els.profileBanner.value = profile.bannerUri || "";
    if (els.profileTheme) els.profileTheme.value = safeStringify(profile.theme || {});

    if (els.profilePreviewJson) {
      els.profilePreviewJson.textContent = safeStringify(profile);
    }
  }

  function getProfilePayload() {
    return {
      uid: normalizeUid(els.profileUid?.value),
      username: String(els.profileUsername?.value || "").trim(),
      wallet_address: String(els.profileWallet?.value || "").trim().toUpperCase(),
      display_name: String(els.profileDisplayName?.value || "").trim(),
      bio: String(els.profileBio?.value || "").trim(),
      avatar_uri: String(els.profileAvatar?.value || "").trim(),
      banner_uri: String(els.profileBanner?.value || "").trim(),
      theme: tryParseJson(String(els.profileTheme?.value || "{}").trim() || "{}", {}),
      ants_balance: toNumberOrZero(els.profileAntsBalance?.value)
    };
  }

  function getAssetPayload() {
    return {
      uid: normalizeUid(els.assetUid?.value),
      ants_balance: toNumberOrZero(els.assetAntsBalance?.value),
      name: String(els.assetName?.value || "").trim(),
      slug: String(els.assetSlug?.value || "").trim(),
      description: String(els.assetDescription?.value || "").trim(),
      image_uri: String(els.assetImage?.value || "").trim(),
      metadata_uri: String(els.assetMetadata?.value || "").trim(),
      traits: tryParseJson(String(els.assetTraits?.value || "[]").trim() || "[]", []),
      ants_stake: toNumberOrZero(els.assetAntsStake?.value),
      status: String(els.assetStatus?.value || "active").trim().toLowerCase()
    };
  }

  function clearAssetComposer() {
    if (els.assetName) els.assetName.value = "";
    if (els.assetSlug) els.assetSlug.value = "";
    if (els.assetDescription) els.assetDescription.value = "";
    if (els.assetImage) els.assetImage.value = "";
    if (els.assetMetadata) els.assetMetadata.value = "";
    if (els.assetTraits) els.assetTraits.value = "";
    if (els.assetAntsStake) els.assetAntsStake.value = "0";
    if (els.assetStatus) els.assetStatus.value = "active";
  }

  function renderAssets(items) {
    state.myAssets = Array.isArray(items) ? items : [];
    if (els.kpiMyAssets) {
      els.kpiMyAssets.textContent = String(state.myAssets.length);
    }

    if (!els.assetList) return;

    if (!state.myAssets.length) {
      els.assetList.innerHTML = '<div class="status info">No assets found for this UID.</div>';
      return;
    }

    const html = state.myAssets.map((asset) => {
      const traitsText = safeStringify(asset.traits || []);
      return `
        <article class="asset-item" data-asset-id="${escapeHtml(asset.id)}">
          <div class="asset-head">
            <strong>${escapeHtml(asset.name || "Unnamed Asset")}</strong>
            <span class="pill">${escapeHtml(asset.status || "active")}</span>
          </div>
          <div class="mono">${escapeHtml(asset.id)}</div>
          <div class="row">
            <div class="field">
              <label>Name</label>
              <input class="input asset-name" type="text" value="${escapeHtmlAttr(asset.name || "")}">
            </div>
            <div class="field">
              <label>Status</label>
              <select class="select asset-status">
                ${buildStatusOption(asset.status, "active")}
                ${buildStatusOption(asset.status, "draft")}
                ${buildStatusOption(asset.status, "locked")}
              </select>
            </div>
          </div>
          <div class="row-1 field">
            <label>Description</label>
            <textarea class="textarea asset-description">${escapeHtml(asset.description || "")}</textarea>
          </div>
          <div class="row">
            <div class="field">
              <label>Image URI</label>
              <input class="input asset-image" type="text" value="${escapeHtmlAttr(asset.imageUri || "")}">
            </div>
            <div class="field">
              <label>Metadata URI</label>
              <input class="input asset-metadata" type="text" value="${escapeHtmlAttr(asset.metadataUri || "")}">
            </div>
          </div>
          <div class="row">
            <div class="field">
              <label>ANTS Stake</label>
              <input class="input asset-stake" type="number" min="0" step="1" value="${escapeHtmlAttr(String(asset.antsStake || 0))}">
            </div>
            <div class="field">
              <label>Slug</label>
              <input class="input asset-slug" type="text" value="${escapeHtmlAttr(asset.slug || "")}">
            </div>
          </div>
          <div class="row-1 field">
            <label>Traits JSON</label>
            <textarea class="textarea asset-traits">${escapeHtml(traitsText)}</textarea>
          </div>
          <div class="asset-actions">
            <button class="btn btn-main asset-save" type="button">Save Asset</button>
          </div>
        </article>
      `;
    }).join("");

    els.assetList.innerHTML = html;

    const saveButtons = Array.from(els.assetList.querySelectorAll(".asset-save"));
    saveButtons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".asset-item");
        if (!card) return;

        const assetId = String(card.getAttribute("data-asset-id") || "").trim();
        const uid = normalizeUid(els.assetUid?.value || els.profileUid?.value);
        if (!assetId || !uid) {
          setStatus(els.assetStatusBox, "bad", "Asset update failed: missing uid or asset id.");
          return;
        }

        const payload = {
          uid,
          name: card.querySelector(".asset-name")?.value || "",
          status: card.querySelector(".asset-status")?.value || "active",
          description: card.querySelector(".asset-description")?.value || "",
          image_uri: card.querySelector(".asset-image")?.value || "",
          metadata_uri: card.querySelector(".asset-metadata")?.value || "",
          ants_stake: toNumberOrZero(card.querySelector(".asset-stake")?.value),
          slug: card.querySelector(".asset-slug")?.value || "",
          traits: tryParseJson(card.querySelector(".asset-traits")?.value || "[]", [])
        };

        try {
          const result = await apiFetch(`/api/nft/assets/${encodeURIComponent(assetId)}`, {
            method: "PATCH",
            body: payload
          });
          setStatus(els.assetStatusBox, "good", `Asset updated: ${result.asset?.name || assetId}`);
          await onLoadAssets();
        } catch (error) {
          setStatus(els.assetStatusBox, "bad", error.message || "Asset update failed");
        }
      });
    });
  }

  function renderFeed(items) {
    if (!els.feedList) return;

    const list = Array.isArray(items) ? items : [];
    if (els.kpiFeedCount) {
      els.kpiFeedCount.textContent = String(list.length);
    }

    if (!list.length) {
      els.feedList.innerHTML = '<div class="status info">No colony activity yet.</div>';
      return;
    }

    els.feedList.innerHTML = list.map((item) => {
      return `
        <article class="feed-item">
          <div class="feed-head">
            <strong>${escapeHtml(item.name || "Unnamed")}</strong>
            <span class="pill">${escapeHtml(item.ownerDisplayName || item.uid || "unknown")}</span>
          </div>
          <div class="mono">${escapeHtml(item.id || "")}</div>
          <p class="muted" style="margin-top:7px;">
            Status: ${escapeHtml(item.status || "active")} | Stake: ${escapeHtml(String(item.antsStake || 0))} ANTS
          </p>
        </article>
      `;
    }).join("");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeHtmlAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function buildStatusOption(selected, option) {
    const isSelected = String(selected || "").trim().toLowerCase() === option;
    return `<option value="${option}"${isSelected ? " selected" : ""}>${option}</option>`;
  }

  async function onSaveApiBase() {
    const base = String(els.apiBaseUrl?.value || "").trim().replace(/\/$/, "");
    if (!base) {
      setStatus(els.apiStatus, "bad", "Please enter API base URL.");
      return;
    }

    saveApiBase(base);
    setStatus(els.apiStatus, "good", `Saved API base URL: ${base}`);
  }

  async function onTestApi() {
    try {
      const result = await apiFetch("/api/nft/config");
      state.minAnts = Number(result?.policy?.minAntsForProfileCreation || 1000);
      if (els.kpiMinAnts) {
        els.kpiMinAnts.textContent = String(state.minAnts);
      }
      setStatus(
        els.apiStatus,
        "good",
        `Connected. No-burn policy is ${result?.policy?.noBurn ? "active" : "unknown"}. Min profile stake: ${state.minAnts} ANTS.`
      );
    } catch (error) {
      setStatus(els.apiStatus, "bad", error.message || "Could not reach NFT API");
    }
  }

  async function onLoadProfile() {
    const uid = normalizeUid(els.profileUid?.value);
    if (!uid) {
      setStatus(els.profileStatus, "bad", "UID is required.");
      return;
    }

    try {
      const result = await apiFetch(`/api/nft/profile/${encodeURIComponent(uid)}`);
      renderProfile(result.profile);
      renderAssets(result.assets || []);
      setStatus(els.profileStatus, "good", `Profile loaded for UID ${uid}.`);
      if (result.profile?.antsBalance != null) {
        syncAntsAcrossForms(result.profile.antsBalance);
      }
    } catch (error) {
      setStatus(els.profileStatus, "bad", error.message || "Profile load failed.");
    }
  }

  async function onSaveProfile() {
    const payload = getProfilePayload();
    if (!payload.uid) {
      setStatus(els.profileStatus, "bad", "UID is required.");
      return;
    }

    try {
      const result = await apiFetch("/api/nft/profile/upsert", {
        method: "POST",
        body: payload
      });
      renderProfile(result.profile);
      syncUidAcrossForms(payload.uid);
      syncAntsAcrossForms(payload.ants_balance);
      setStatus(els.profileStatus, "good", `Profile saved for UID ${payload.uid}.`);
    } catch (error) {
      setStatus(els.profileStatus, "bad", error.message || "Profile save failed.");
    }
  }

  async function onCreateAsset() {
    const payload = getAssetPayload();
    if (!payload.uid || !payload.name) {
      setStatus(els.assetStatusBox, "bad", "UID and asset name are required.");
      return;
    }

    try {
      const result = await apiFetch("/api/nft/assets/create", {
        method: "POST",
        body: payload
      });
      setStatus(els.assetStatusBox, "good", `Asset created: ${result.asset?.name || "new asset"}`);
      clearAssetComposer();
      await onLoadAssets();
      await onLoadFeed();
    } catch (error) {
      setStatus(els.assetStatusBox, "bad", error.message || "Asset creation failed.");
    }
  }

  async function onLoadAssets() {
    const uid = normalizeUid(els.assetUid?.value || els.profileUid?.value);
    if (!uid) {
      setStatus(els.assetStatusBox, "bad", "UID is required to load assets.");
      return;
    }

    try {
      const result = await apiFetch(`/api/nft/assets/${encodeURIComponent(uid)}`);
      renderAssets(result.assets || []);
      setStatus(els.assetStatusBox, "good", `Loaded ${result.count || 0} assets.`);
    } catch (error) {
      setStatus(els.assetStatusBox, "bad", error.message || "Asset load failed.");
    }
  }

  async function onLoadFeed() {
    try {
      const result = await apiFetch("/api/nft/colony/feed?limit=30");
      renderFeed(result.assets || []);
    } catch (error) {
      if (els.feedList) {
        els.feedList.innerHTML = `<div class="status bad">${escapeHtml(error.message || "Feed load failed")}</div>`;
      }
    }
  }
})();
