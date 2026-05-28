"use strict";

(function initNftStudio() {
  const els = {
    apiBaseUrl: document.getElementById("api-base-url"),
    apiStatus: document.getElementById("api-status"),
    saveApiBtn: document.getElementById("save-api-btn"),
    testApiBtn: document.getElementById("test-api-btn"),
    minerLoginUid: document.getElementById("miner-login-uid"),
    minerLoginUsername: document.getElementById("miner-login-username"),
    minerLoginWallet: document.getElementById("miner-login-wallet"),
    minerLoginBtn: document.getElementById("miner-login-btn"),
    minerLogoutBtn: document.getElementById("miner-logout-btn"),
    minerAuthStatus: document.getElementById("miner-auth-status"),

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

    marketSellerId: document.getElementById("market-seller-id"),
    marketAssetId: document.getElementById("market-asset-id"),
    marketListingType: document.getElementById("market-listing-type"),
    marketDurationHours: document.getElementById("market-duration-hours"),
    marketAskPrice: document.getElementById("market-ask-price"),
    marketMinBid: document.getElementById("market-min-bid"),
    marketBuyNow: document.getElementById("market-buy-now"),
    marketCreateBtn: document.getElementById("market-create-btn"),
    marketRefreshBtn: document.getElementById("market-refresh-btn"),
    marketStatus: document.getElementById("market-status"),
    marketActorId: document.getElementById("market-actor-id"),
    marketFilterStatus: document.getElementById("market-filter-status"),
    marketFilterType: document.getElementById("market-filter-type"),
    marketList: document.getElementById("market-list"),

    analyticsViewTotal: document.getElementById("analytics-view-total"),
    analyticsClickTotal: document.getElementById("analytics-click-total"),
    analyticsUniqueAssets: document.getElementById("analytics-unique-assets"),
    analyticsBars: document.getElementById("analytics-bars"),
    analyticsTopList: document.getElementById("analytics-top-list"),

    nftViewer: document.getElementById("nft-image-viewer"),
    nftViewerImage: document.getElementById("nft-viewer-image"),
    nftViewerTitle: document.getElementById("nft-viewer-title"),
    nftViewerClose: document.getElementById("nft-viewer-close"),

    kpiMinAnts: document.getElementById("kpi-min-ants"),
    kpiFeedCount: document.getElementById("kpi-feed-count"),
    kpiMyAssets: document.getElementById("kpi-my-assets"),

    collectionsRefreshBtn: document.getElementById("collections-refresh-btn"),
    collectionsList: document.getElementById("collections-list"),

    domainUid: document.getElementById("domain-uid"),
    domainName: document.getElementById("domain-name"),
    domainDescription: document.getElementById("domain-description"),
    domainLogoUri: document.getElementById("domain-logo-uri"),
    domainBannerUri: document.getElementById("domain-banner-uri"),
    domainImageUri: document.getElementById("domain-image-uri"),
    domainAntsStake: document.getElementById("domain-ants-stake"),
    domainTheme: document.getElementById("domain-theme"),
    domainLinks: document.getElementById("domain-links"),
    domainCreateBtn: document.getElementById("domain-create-btn"),
    domainLoadBtn: document.getElementById("domain-load-btn"),
    domainStatus: document.getElementById("domain-status"),
    domainList: document.getElementById("domain-list"),

    // Token Factory (PoS — closed-loop ANTS)
    factoryUid: document.getElementById("factory-uid"),
    factoryStakeAmount: document.getElementById("factory-stake-amount"),
    factoryStakeBtn: document.getElementById("factory-stake-btn"),
    factoryUnstakeBtn: document.getElementById("factory-unstake-btn"),
    factoryCheckEligibilityBtn: document.getElementById("factory-check-eligibility-btn"),
    factoryStakeStatus: document.getElementById("factory-stake-status"),
    factoryTokenName: document.getElementById("factory-token-name"),
    factoryTokenSymbol: document.getElementById("factory-token-symbol"),
    factoryTokenSupply: document.getElementById("factory-token-supply"),
    factoryTokenDecimals: document.getElementById("factory-token-decimals"),
    factoryTokenDescription: document.getElementById("factory-token-description"),
    factoryTokenLogo: document.getElementById("factory-token-logo"),
    factoryTokenMintable: document.getElementById("factory-token-mintable"),
    factoryDeployBtn: document.getElementById("factory-deploy-btn"),
    factoryLoadTokensBtn: document.getElementById("factory-load-tokens-btn"),
    factoryDeployStatus: document.getElementById("factory-deploy-status"),
    factoryTokensList: document.getElementById("factory-tokens-list")
  };

  const state = {
    apiBase: resolveInitialApiBase(),
    minAnts: 1000,
    minDomainAuctionBidAnts: 10000,
    minFactoryStakeAnts: 1000,
    factoryDeployFeeAnts: 500,
    factoryStakeCooldownDays: 7,
    factoryEligible: false,
    factoryStakedAnts: 0,
    myAssets: [],
    marketListings: [],
    apiReady: false,
    minerAuthenticated: false,
    minerSessionToken: "",
    minerUid: "",
    // Profile NFT = real decentralized identity. The Token Factory and any
    // future PoS-gated action requires this to be active, NOT just a miner
    // session. A miner session proves the wallet; the Profile NFT proves
    // the on-chain identity has been minted + first-cashout activated.
    nftActivated: false,
    nftTokenId: "",
    analytics: loadAnalyticsState()
  };

  if (els.apiBaseUrl) {
    els.apiBaseUrl.value = state.apiBase;
  }

  wireEvents();
  bootstrap();

  function wireEvents() {
    els.saveApiBtn?.addEventListener("click", onSaveApiBase);
    els.testApiBtn?.addEventListener("click", onTestApi);
    els.minerLoginBtn?.addEventListener("click", onMinerLogin);
    els.minerLogoutBtn?.addEventListener("click", onMinerLogout);
    els.profileSaveBtn?.addEventListener("click", onSaveProfile);
    els.profileLoadBtn?.addEventListener("click", onLoadProfile);
    els.assetCreateBtn?.addEventListener("click", onCreateAsset);
    els.assetLoadBtn?.addEventListener("click", onLoadAssets);
    els.feedRefreshBtn?.addEventListener("click", onLoadFeed);
    els.marketCreateBtn?.addEventListener("click", onCreateMarketListing);
    els.marketRefreshBtn?.addEventListener("click", onLoadMarketListings);
    els.marketListingType?.addEventListener("change", onMarketListingTypeChanged);
    els.marketFilterStatus?.addEventListener("change", onLoadMarketListings);
    els.marketFilterType?.addEventListener("change", onLoadMarketListings);
    els.nftViewerClose?.addEventListener("click", closeNftImageViewer);
    els.nftViewer?.addEventListener("click", (event) => {
      if (event.target === els.nftViewer) {
        closeNftImageViewer();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeNftImageViewer();
      }
    });
    els.collectionsRefreshBtn?.addEventListener("click", onLoadCollections);
    els.domainCreateBtn?.addEventListener("click", onCreateColonyDomain);
    els.domainLoadBtn?.addEventListener("click", onLoadColonyDomains);

    // Token Factory wiring
    els.factoryStakeBtn?.addEventListener("click", onFactoryStake);
    els.factoryUnstakeBtn?.addEventListener("click", onFactoryUnstake);
    els.factoryCheckEligibilityBtn?.addEventListener("click", onFactoryRefreshEligibility);
    els.factoryDeployBtn?.addEventListener("click", onFactoryDeployToken);
    els.factoryLoadTokensBtn?.addEventListener("click", onFactoryLoadMyTokens);
  }

  async function bootstrap() {
    renderAnalyticsPanel();
    window.setInterval(renderAnalyticsPanel, 5000);
    onMarketListingTypeChanged();
    const connected = await onTestApi();
    if (connected) {
      await onLoadCollections();
      await onLoadColonyDomains();
      await onLoadFeed();
      await onLoadMarketListings();
    }
  }

  function isStaticWebsiteBase(base) {
    const clean = String(base || "").trim().replace(/\/$/, "");
    if (!clean) {
      return false;
    }
    try {
      const parsed = new URL(clean);
      const host = String(parsed.hostname || "").toLowerCase();
      return host === "a-network.net" || host === "www.a-network.net";
    } catch {
      return false;
    }
  }

  function normalizeApiBaseInput(base) {
    const clean = String(base || "").trim().replace(/\/$/, "");
    if (!clean) {
      return "";
    }
    if (isStaticWebsiteBase(clean) || clean === window.location.origin) {
      return "https://rmp-site.onrender.com";
    }
    return clean;
  }

  function resolveInitialApiBase() {
    const fromQuery = normalizeApiBaseInput(String(new URLSearchParams(window.location.search).get("api") || "").trim());
    if (fromQuery) {
      return fromQuery.replace(/\/$/, "");
    }

    const saved = normalizeApiBaseInput(String(localStorage.getItem("anet_nft_api_base") || "").trim());
    if (saved) {
      return saved;
    }

    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      return "http://localhost:3001";
    }

    if (window.location.hostname === "a-network.net" || window.location.hostname === "www.a-network.net") {
      return "https://rmp-site.onrender.com";
    }

    return "";
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
      throw new Error("Set API base URL first (your backend domain), then test API.");
    }

    const method = String(options.method || "GET").trim().toUpperCase();
    const isPublicNftReadRoute = method === "GET" && (
      (path === "/api/nft/colony/feed" || path.startsWith("/api/nft/colony/feed?"))
      || path.startsWith("/api/nft/market/listings")
      || path === "/api/nft/collections"
      || path.startsWith("/api/nft/collections?")
      || path === "/api/nft/domains"
      || path.startsWith("/api/nft/domains?")
    );

    const isProtectedNftRoute = path.startsWith("/api/nft/")
      && path !== "/api/nft/config"
      && path !== "/api/nft/auth/miner-login"
      && !isPublicNftReadRoute;

    if (isProtectedNftRoute && !state.minerSessionToken) {
      throw new Error("Miner login required for NFT access.");
    }

    const authHeaders = isProtectedNftRoute
      ? { "X-ANET-MINER-SESSION": state.minerSessionToken }
      : {};

    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
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
    if (els.marketSellerId) els.marketSellerId.value = uid;
    if (els.marketActorId) els.marketActorId.value = uid;
    if (els.domainUid) els.domainUid.value = uid;
  }

  function getMinerLoginPayload() {
    return {
      uid: normalizeUid(els.minerLoginUid?.value),
      anet_profile_id: normalizeUid(els.minerLoginUid?.value),
      username: String(els.minerLoginUsername?.value || "").trim(),
      wallet_address: String(els.minerLoginWallet?.value || "").trim().toUpperCase()
    };
  }

  function setMinerAuthState(payload) {
    const uid = normalizeUid(payload?.uid);
    state.minerAuthenticated = Boolean(payload?.sessionToken && uid);
    state.minerSessionToken = String(payload?.sessionToken || "");
    state.minerUid = uid;
    state.nftActivated = Boolean(payload?.nftActivated);
    state.nftTokenId = String(payload?.nftTokenId || payload?.profileNftTokenId || "");

    if (state.minerAuthenticated) {
      syncUidAcrossForms(uid);
      if (els.minerLoginUid) {
        els.minerLoginUid.value = uid;
      }
      if (els.profileUsername && !els.profileUsername.value) {
        els.profileUsername.value = String(payload?.username || "");
      }
      if (els.profileWallet && !els.profileWallet.value) {
        els.profileWallet.value = String(payload?.walletAddress || "");
      }
      setStatus(
        els.minerAuthStatus,
        "good",
        `Miner authenticated for ANET Profile ID ${uid}. ${payload?.nftActivated ? "NFT activated." : "Complete first cashout/swap to activate NFT profile."}`
      );
      return;
    }

    state.minerAuthenticated = false;
    state.minerSessionToken = "";
    state.minerUid = "";
    state.nftActivated = false;
    state.nftTokenId = "";
    setStatus(els.minerAuthStatus, "info", "Miner login required for create/list/bid/buy actions. Feed and market browsing are public.");
  }

  function ensureMinerLoggedIn(statusEl) {
    if (state.minerAuthenticated && state.minerSessionToken) {
      return true;
    }
    setStatus(statusEl || els.minerAuthStatus, "bad", "Login as miner first (UID + username + wallet address).");
    return false;
  }

  // Stronger gate: requires an *active* Profile NFT, not just a miner session.
  // Used by the Token Factory and any future PoS-gated action that should be
  // bound to the on-chain decentralized identity rather than a fungible login.
  function ensureNftIdentity(statusEl) {
    if (!ensureMinerLoggedIn(statusEl)) return false;
    if (state.nftActivated && state.nftTokenId) {
      return true;
    }
    setStatus(
      statusEl || els.minerAuthStatus,
      "bad",
      "This action requires an active ANET Profile NFT. Complete your first cashout/swap in the wallet app to mint and activate your Profile NFT, then re-login here."
    );
    return false;
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
      anet_profile_id: normalizeUid(els.profileUid?.value),
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
      anet_profile_id: normalizeUid(els.assetUid?.value),
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

  function onMarketListingTypeChanged() {
    const listingType = String(els.marketListingType?.value || "fixed").trim().toLowerCase();
    const isAuction = listingType === "auction" || listingType === "domain-auction";
    const isDomainAuction = listingType === "domain-auction";

    if (els.marketDurationHours) {
      els.marketDurationHours.disabled = !isAuction;
    }
    if (els.marketMinBid) {
      els.marketMinBid.disabled = !isAuction;
    }
    if (els.marketAskPrice) {
      els.marketAskPrice.disabled = isAuction;
    }
    if (els.marketMinBid && isDomainAuction && toNumberOrZero(els.marketMinBid.value) < state.minDomainAuctionBidAnts) {
      els.marketMinBid.value = String(state.minDomainAuctionBidAnts);
    }
  }

  function getMarketListingPayload() {
    const sellerId = normalizeUid(els.marketSellerId?.value || els.profileUid?.value || state.minerUid);
    const listingType = String(els.marketListingType?.value || "fixed").trim().toLowerCase();
    return {
      uid: sellerId,
      anet_profile_id: sellerId,
      asset_id: String(els.marketAssetId?.value || "").trim(),
      listing_type: listingType,
      ask_price_ants: toNumberOrZero(els.marketAskPrice?.value),
      min_bid_ants: toNumberOrZero(els.marketMinBid?.value),
      buy_now_price_ants: toNumberOrZero(els.marketBuyNow?.value),
      duration_hours: toNumberOrZero(els.marketDurationHours?.value || 24)
    };
  }

  function getMarketActorId() {
    return normalizeUid(els.marketActorId?.value || els.profileUid?.value || state.minerUid);
  }

  function formatUtc(value) {
    if (!value) {
      return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  }

  function loadAnalyticsState() {
    const fallback = { assets: {}, events: [] };
    try {
      const raw = localStorage.getItem("anet_nft_live_metrics_v1");
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return {
        assets: parsed && typeof parsed.assets === "object" ? parsed.assets : {},
        events: Array.isArray(parsed?.events) ? parsed.events : []
      };
    } catch {
      return fallback;
    }
  }

  function saveAnalyticsState() {
    localStorage.setItem("anet_nft_live_metrics_v1", JSON.stringify(state.analytics));
  }

  function upsertAssetMetric(assetId, name, imageUri) {
    const key = String(assetId || "").trim();
    if (!key) return null;
    if (!state.analytics.assets[key]) {
      state.analytics.assets[key] = {
        id: key,
        name: String(name || "Unnamed"),
        imageUri: String(imageUri || ""),
        views: 0,
        clicks: 0,
        lastViewAt: 0,
        lastClickAt: 0
      };
    }
    const item = state.analytics.assets[key];
    if (name) item.name = String(name);
    if (imageUri) item.imageUri = String(imageUri);
    return item;
  }

  function trackMetricEvent(kind, assetId, name, imageUri) {
    const asset = upsertAssetMetric(assetId, name, imageUri);
    if (!asset) return;
    const now = Date.now();
    if (kind === "view") {
      asset.views += 1;
      asset.lastViewAt = now;
    } else {
      asset.clicks += 1;
      asset.lastClickAt = now;
    }
    state.analytics.events.push({ t: now, k: kind, a: asset.id });
    const cutoff = now - (30 * 60 * 1000);
    state.analytics.events = state.analytics.events.filter((evt) => Number(evt?.t || 0) >= cutoff);
    saveAnalyticsState();
  }

  function renderAnalyticsPanel() {
    const assets = Object.values(state.analytics.assets || {});
    const totalViews = assets.reduce((sum, item) => sum + Number(item.views || 0), 0);
    const totalClicks = assets.reduce((sum, item) => sum + Number(item.clicks || 0), 0);

    if (els.analyticsViewTotal) els.analyticsViewTotal.textContent = String(totalViews);
    if (els.analyticsClickTotal) els.analyticsClickTotal.textContent = String(totalClicks);
    if (els.analyticsUniqueAssets) els.analyticsUniqueAssets.textContent = String(assets.length);

    if (els.analyticsBars) {
      const now = Date.now();
      const bucketMs = 60 * 1000;
      const buckets = [];
      for (let i = 11; i >= 0; i -= 1) {
        const start = now - (i * bucketMs);
        const end = start + bucketMs;
        const count = state.analytics.events.filter((evt) => evt.t >= start && evt.t < end).length;
        buckets.push(count);
      }
      const max = Math.max(1, ...buckets);
      els.analyticsBars.innerHTML = buckets.map((count) => {
        const h = Math.max(8, Math.round((count / max) * 64));
        return `<div class="analytics-bar" style="height:${h}px" title="${count} events"></div>`;
      }).join("");
    }

    if (els.analyticsTopList) {
      const top = assets
        .sort((a, b) => ((b.views + b.clicks) - (a.views + a.clicks)))
        .slice(0, 5);
      if (!top.length) {
        els.analyticsTopList.innerHTML = '<div class="muted">No tracking data yet.</div>';
      } else {
        els.analyticsTopList.innerHTML = top.map((item) => {
          return `<div class="mono">${escapeHtml(item.name)} | views: ${escapeHtml(String(item.views))} | clicks: ${escapeHtml(String(item.clicks))}</div>`;
        }).join("");
      }
    }
  }

  function attachImageErrorHandlers(scopeEl) {
    if (!scopeEl) return;
    const imgs = Array.from(scopeEl.querySelectorAll("img.track-nft-image"));
    imgs.forEach((img) => {
      img.addEventListener("error", () => {
        img.style.display = "none";
        const container = img.parentElement;
        if (container) {
          container.innerHTML = '<div style="background:#f0f0f0; display:flex; align-items:center; justify-content:center; font-size:12px; color:#999; width:100%; height:100%;">Image not found</div>';
        }
      }, { once: true });

      img.addEventListener("click", () => {
        const assetId = String(img.getAttribute("data-asset-id") || "").trim();
        const assetName = String(img.getAttribute("data-asset-name") || "").trim();
        const imageUri = String(img.getAttribute("data-image-uri") || "").trim();
        trackMetricEvent("click", assetId, assetName, imageUri);
        renderAnalyticsPanel();
        if (imageUri) {
          openNftImageViewer(imageUri, assetName || "NFT Image");
        }
      });
    });
  }

  function openNftImageViewer(imageUri, title) {
    if (!els.nftViewer || !els.nftViewerImage) {
      return;
    }
    els.nftViewerImage.src = String(imageUri || "").trim();
    els.nftViewerImage.alt = String(title || "NFT Image");
    if (els.nftViewerTitle) {
      els.nftViewerTitle.textContent = String(title || "NFT Image");
    }
    els.nftViewer.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeNftImageViewer() {
    if (!els.nftViewer || !els.nftViewerImage) {
      return;
    }
    els.nftViewer.classList.remove("open");
    els.nftViewerImage.src = "";
    document.body.style.overflow = "";
  }

  function renderAssets(items) {
    state.myAssets = Array.isArray(items) ? items : [];
    if (els.kpiMyAssets) {
      els.kpiMyAssets.textContent = String(state.myAssets.length);
    }

    if (!els.assetList) return;

    if (!state.myAssets.length) {
      els.assetList.innerHTML = '<div class="status info">No assets found for this ANET Profile ID.</div>';
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
            <button class="btn btn-alt asset-list-market" type="button">List On Market</button>
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
          anet_profile_id: uid,
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

      btn.closest(".asset-item")?.querySelector(".asset-list-market")?.addEventListener("click", () => {
        const card = btn.closest(".asset-item");
        if (!card) return;
        const assetId = String(card.getAttribute("data-asset-id") || "").trim();
        const uid = normalizeUid(els.assetUid?.value || els.profileUid?.value);

        if (els.marketAssetId) {
          els.marketAssetId.value = assetId;
        }
        if (els.marketSellerId) {
          els.marketSellerId.value = uid;
        }
        if (els.marketActorId && uid) {
          els.marketActorId.value = uid;
        }

        setStatus(els.marketStatus, "info", `Prepared listing form for asset ${assetId}.`);
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
      renderAnalyticsPanel();
      return;
    }

    els.feedList.innerHTML = list.map((item) => {
      const assetId = String(item.id || "").trim();
      const assetName = String(item.name || "Unnamed").trim();
      const imageUri = String(item.imageUri || "").trim();

      if (assetId) {
        trackMetricEvent("view", assetId, assetName, imageUri);
      }

      const imageHtml = item.imageUri
        ? `<div class="feed-image-container"><img src="${escapeHtmlAttr(imageUri)}" alt="${escapeHtmlAttr(assetName || 'NFT Art')}" class="feed-image track-nft-image" data-asset-id="${escapeHtmlAttr(assetId)}" data-asset-name="${escapeHtmlAttr(assetName)}" data-image-uri="${escapeHtmlAttr(imageUri)}" loading="lazy"></div>`
        : `<div class="feed-image-container" style="background:#f0f0f0; display:flex; align-items:center; justify-content:center; font-size:12px; color:#999;">No image</div>`;

      const domainBadge = item.isDomain || item.assetType === "domain"
        ? `<span class="badge-domain">&#x1F41C; .ant Domain</span>`
        : "";
      const genesisBadge = item.isGenesis || item.assetType === "genesis"
        ? `<span class="badge-genesis">&#x2B50; Genesis #${item.serialNumber != null ? item.serialNumber : "?"}</span>`
        : "";

      return `
        <article class="feed-item">
          ${imageHtml}
          <div class="feed-head">
            <strong>${escapeHtml(item.name || "Unnamed")}</strong>
            <span class="pill">${escapeHtml(item.ownerDisplayName || item.uid || "unknown")}</span>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">${domainBadge}${genesisBadge}</div>
          <div class="mono">${escapeHtml(item.id || "")}</div>
          <p class="muted" style="margin-top:7px;">
            Status: ${escapeHtml(item.status || "active")} | Stake: ${escapeHtml(String(item.antsStake || 0))} ANTS
          </p>
          ${item.isDomain && item.colony?.description ? `<p class="muted" style="margin-top:4px;">${escapeHtml(item.colony.description.slice(0, 120))}${item.colony.description.length > 120 ? "…" : ""}</p>` : ""}
        </article>
      `;
    }).join("");

    attachImageErrorHandlers(els.feedList);
    renderAnalyticsPanel();
  }

  function renderMarketListings(items) {
    state.marketListings = Array.isArray(items) ? items : [];
    if (!els.marketList) return;

    if (!state.marketListings.length) {
      els.marketList.innerHTML = '<div class="status info">No marketplace listings found for selected filter.</div>';
      renderAnalyticsPanel();
      return;
    }

    els.marketList.innerHTML = state.marketListings.map((listing) => {
      const listingType = String(listing.listingType || "fixed").toLowerCase();
      const listingTypeLabel = listingType === "domain-auction" ? "domain-auction (.ant)" : listingType;
      const status = String(listing.status || "active").toLowerCase();
      const owner = listing?.sellerDisplayName || listing?.sellerUid || "unknown";
      const assetName = listing?.asset?.name || "Unnamed Asset";
      const ask = Number(listing.askPriceAnts || 0);
      const minBid = Number(listing.minBidAnts || 0);
      const buyNow = Number(listing.buyNowPriceAnts || 0);
      const highest = Number(listing.highestBidAnts || 0);
      const bidCount = Number(listing.bidCount || 0);
      const timeText = listing.endAt ? `Ends: ${formatUtc(listing.endAt)}` : `Listed: ${formatUtc(listing.createdAt)}`;
      const expiredBadge = listing.isExpired ? '<span class="pill">expired</span>' : "";

      const assetImageUri = listing?.asset?.imageUri || "";
      const trackedAssetId = String(listing.assetId || listing?.asset?.id || "").trim();
      if (trackedAssetId) {
        trackMetricEvent("view", trackedAssetId, assetName, assetImageUri);
      }

      const imageHtml = assetImageUri
        ? `<div class="market-image-container"><img src="${escapeHtmlAttr(assetImageUri)}" alt="${escapeHtmlAttr(assetName)}" class="market-image track-nft-image" data-asset-id="${escapeHtmlAttr(trackedAssetId)}" data-asset-name="${escapeHtmlAttr(assetName)}" data-image-uri="${escapeHtmlAttr(assetImageUri)}" loading="lazy"></div>`
        : `<div class="market-image-container" style="background:#f0f0f0; display:flex; align-items:center; justify-content:center; font-size:12px; color:#999;">No image</div>`;

      const domainBadge = listing?.asset?.isDomain || listing?.asset?.assetType === "domain"
        ? `<span class="badge-domain">&#x1F41C; .ant Domain</span>`
        : "";
      const genesisBadge = listing?.asset?.isGenesis || listing?.asset?.assetType === "genesis"
        ? `<span class="badge-genesis">&#x2B50; Genesis #${listing?.asset?.serialNumber != null ? listing.asset.serialNumber : "?"}</span>`
        : "";

      const marketActions = status === "active"
        ? `
          <div class="asset-actions">
            <input class="input market-bid-amount" type="number" min="0" step="1" placeholder="Bid ANTS" style="max-width:150px;">
            ${listingType === "auction" || listingType === "domain-auction" ? '<button class="btn btn-alt market-bid-btn" type="button">Place Bid</button>' : ''}
            <button class="btn btn-main market-buy-btn" type="button">Buy</button>
            <button class="btn btn-danger market-close-btn" type="button">Close</button>
            <button class="btn btn-alt market-bids-btn" type="button">View Bids</button>
          </div>
        `
        : '<div class="status info">Listing closed.</div>';

      return `
        <article class="asset-item" data-listing-id="${escapeHtmlAttr(listing.id || "")}" data-asset-id="${escapeHtmlAttr(trackedAssetId)}" data-asset-name="${escapeHtmlAttr(assetName)}" data-image-uri="${escapeHtmlAttr(assetImageUri)}">
          ${imageHtml}
          <div class="asset-head">
            <strong>${escapeHtml(assetName)}</strong>
            <span class="pill">${escapeHtml(status)}</span>
          </div>
          <div class="asset-head" style="margin-top:4px;">
            <span class="pill">${escapeHtml(listingTypeLabel)}</span>
            ${expiredBadge}
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">${domainBadge}${genesisBadge}</div>
          <div class="mono">Listing: ${escapeHtml(listing.id || "")}</div>
          <div class="mono">Asset: ${escapeHtml(listing.assetId || "")}</div>
          <p class="muted" style="margin-top:7px;">Seller: ${escapeHtml(owner)} | ${escapeHtml(timeText)}</p>
          <p class="muted" style="margin-top:7px;">
            Ask: ${escapeHtml(String(ask))} ANTS | Min Bid: ${escapeHtml(String(minBid))} ANTS | Buy Now: ${escapeHtml(String(buyNow))} ANTS
          </p>
          <p class="muted" style="margin-top:7px;">Highest Bid: ${escapeHtml(String(highest))} ANTS (${escapeHtml(String(bidCount))} bids)</p>
          ${listing?.asset?.isDomain && listing?.asset?.colony?.description ? `<p class="muted" style="margin-top:4px;">${escapeHtml((listing.asset.colony.description || "").slice(0, 120))}${(listing.asset.colony.description || "").length > 120 ? "…" : ""}</p>` : ""}
          ${marketActions}
          <div class="status info market-inline-status" style="display:none; margin-top:8px;"></div>
        </article>
      `;
    }).join("");

    const cards = Array.from(els.marketList.querySelectorAll(".asset-item"));
    attachImageErrorHandlers(els.marketList);

    cards.forEach((card) => {
      const listingId = String(card.getAttribute("data-listing-id") || "").trim();
      const assetId = String(card.getAttribute("data-asset-id") || "").trim();
      const assetName = String(card.getAttribute("data-asset-name") || "").trim();
      const imageUri = String(card.getAttribute("data-image-uri") || "").trim();
      const statusBox = card.querySelector(".market-inline-status");

      const setInline = (type, message) => {
        if (!statusBox) return;
        statusBox.style.display = "block";
        statusBox.className = `status ${type} market-inline-status`;
        statusBox.textContent = message;
      };

      card.querySelector(".market-bid-btn")?.addEventListener("click", async () => {
        trackMetricEvent("click", assetId, assetName, imageUri);
        renderAnalyticsPanel();
        const actorId = getMarketActorId();
        const amount = toNumberOrZero(card.querySelector(".market-bid-amount")?.value);
        if (!actorId || !listingId || amount <= 0) {
          setInline("bad", "Need profile ID and bid amount.");
          return;
        }

        try {
          const result = await apiFetch(`/api/nft/market/listings/${encodeURIComponent(listingId)}/bid`, {
            method: "POST",
            body: {
              uid: actorId,
              anet_profile_id: actorId,
              amount_ants: amount
            }
          });
          setInline("good", result.autoSettled ? "Bid accepted and auto-settled." : "Bid placed successfully.");
          await onLoadMarketListings();
          await onLoadAssets();
          await onLoadFeed();
        } catch (error) {
          setInline("bad", error.message || "Bid failed.");
        }
      });

      card.querySelector(".market-buy-btn")?.addEventListener("click", async () => {
        trackMetricEvent("click", assetId, assetName, imageUri);
        renderAnalyticsPanel();
        const actorId = getMarketActorId();
        if (!actorId || !listingId) {
          setInline("bad", "Need profile ID for buy action.");
          return;
        }

        try {
          await apiFetch(`/api/nft/market/listings/${encodeURIComponent(listingId)}/buy`, {
            method: "POST",
            body: {
              uid: actorId,
              anet_profile_id: actorId
            }
          });
          setInline("good", "Purchase completed.");
          await onLoadMarketListings();
          await onLoadAssets();
          await onLoadFeed();
        } catch (error) {
          setInline("bad", error.message || "Buy failed.");
        }
      });

      card.querySelector(".market-close-btn")?.addEventListener("click", async () => {
        trackMetricEvent("click", assetId, assetName, imageUri);
        renderAnalyticsPanel();
        const actorId = getMarketActorId();
        if (!actorId || !listingId) {
          setInline("bad", "Need seller profile ID for close action.");
          return;
        }

        try {
          const result = await apiFetch(`/api/nft/market/listings/${encodeURIComponent(listingId)}/close`, {
            method: "POST",
            body: {
              uid: actorId,
              anet_profile_id: actorId
            }
          });
          setInline("good", result.settled ? "Auction settled to highest bidder." : "Listing closed.");
          await onLoadMarketListings();
          await onLoadAssets();
          await onLoadFeed();
        } catch (error) {
          setInline("bad", error.message || "Close failed.");
        }
      });

      card.querySelector(".market-bids-btn")?.addEventListener("click", async () => {
        trackMetricEvent("click", assetId, assetName, imageUri);
        renderAnalyticsPanel();
        if (!listingId) {
          setInline("bad", "Missing listing ID.");
          return;
        }

        try {
          const result = await apiFetch(`/api/nft/market/listings/${encodeURIComponent(listingId)}/bids`);
          const top = Array.isArray(result.bids) ? result.bids.slice(0, 3) : [];
          if (!top.length) {
            setInline("info", "No bids yet.");
            return;
          }
          const summary = top.map((bid) => `${bid.bidderDisplayName || bid.bidderUid}: ${bid.amountAnts}`).join(" | ");
          setInline("info", `Top bids: ${summary}`);
        } catch (error) {
          setInline("bad", error.message || "Could not load bids.");
        }
      });
    });

    renderAnalyticsPanel();
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
    const base = normalizeApiBaseInput(String(els.apiBaseUrl?.value || "").trim());
    if (!base) {
      setStatus(els.apiStatus, "bad", "Please enter API base URL (backend domain). Example: https://your-backend.onrender.com");
      return;
    }

    saveApiBase(base);
    setStatus(els.apiStatus, "good", `Saved API base URL: ${base}`);
  }

  async function onMinerLogin() {
    if (!state.apiReady) {
      setStatus(els.minerAuthStatus, "bad", "Connect NFT API first using Test API.");
      return;
    }

    const payload = getMinerLoginPayload();
    if (!payload.uid || !payload.username || !payload.wallet_address) {
      setStatus(els.minerAuthStatus, "bad", "UID, username, and wallet address are required for miner login.");
      return;
    }

    try {
      const result = await apiFetch("/api/nft/auth/miner-login", {
        method: "POST",
        body: payload
      });
      setMinerAuthState(result);
      await onLoadProfile();
      await onLoadFeed();
      await onLoadMarketListings();
    } catch (error) {
      setMinerAuthState(null);
      setStatus(els.minerAuthStatus, "bad", error.message || "Miner login failed.");
    }
  }

  async function onMinerLogout() {
    try {
      if (state.minerSessionToken) {
        await apiFetch("/api/nft/auth/logout", { method: "POST" });
      }
    } catch {
      // Best-effort logout.
    }

    setMinerAuthState(null);
    await onLoadFeed();
    await onLoadMarketListings();
  }

  async function onTestApi() {
    const fallbackBases = [
      "https://pi-backend-q2ye.onrender.com",
      "https://pi-backend.onrender.com"
    ];

    try {
      const result = await apiFetch("/api/nft/config");
      state.minAnts = Number(result?.policy?.minAntsForProfileCreation || 1000);
      state.minDomainAuctionBidAnts = Number(result?.policy?.minDomainAuctionBidAnts || 10000);
      state.apiReady = true;
      onMarketListingTypeChanged();
      if (els.kpiMinAnts) {
        els.kpiMinAnts.textContent = String(state.minAnts);
      }
      setStatus(
        els.apiStatus,
        "good",
        `Connected. No-burn policy is ${result?.policy?.noBurn ? "active" : "unknown"}. NFT unlock rule: first successful cashout/swap activates profile.`
      );
      if (!state.minerAuthenticated) {
        setStatus(els.minerAuthStatus, "info", "Miner login required for create/list/bid/buy actions. Feed and market browsing are public.");
      }
      return true;
    } catch (error) {
      const currentBase = getApiBase();
      const shouldAutoSwitch = !currentBase || currentBase === window.location.origin || isStaticWebsiteBase(currentBase);

      if (shouldAutoSwitch) {
        for (const candidate of fallbackBases) {
          if (!candidate || candidate === currentBase) {
            continue;
          }
          try {
            saveApiBase(candidate);
            const result = await apiFetch("/api/nft/config");
            state.minAnts = Number(result?.policy?.minAntsForProfileCreation || 1000);
            state.minDomainAuctionBidAnts = Number(result?.policy?.minDomainAuctionBidAnts || 10000);
            state.apiReady = true;
            onMarketListingTypeChanged();
            if (els.kpiMinAnts) {
              els.kpiMinAnts.textContent = String(state.minAnts);
            }
            setStatus(
              els.apiStatus,
              "good",
              `Connected. API auto-routed to ${candidate}.`
            );
            if (!state.minerAuthenticated) {
              setStatus(els.minerAuthStatus, "info", "Miner login required for create/list/bid/buy actions. Feed and market browsing are public.");
            }
            return true;
          } catch {
            // try next fallback
          }
        }
      }

      state.apiReady = false;
      const base = getApiBase();
      if (base && base === window.location.origin) {
        setStatus(
          els.apiStatus,
          "bad",
          "API URL points to static website domain. Set API base URL to your backend service domain (for example Render backend URL)."
        );
      } else {
        setStatus(els.apiStatus, "bad", error.message || "Could not reach NFT API");
      }
      return false;
    }
  }

  async function onLoadProfile() {
    if (!state.apiReady) {
      setStatus(els.profileStatus, "bad", "Connect NFT API first using Test API.");
      return;
    }
    if (!ensureMinerLoggedIn(els.profileStatus)) {
      return;
    }

    const uid = normalizeUid(els.profileUid?.value || state.minerUid);
    if (!uid) {
      setStatus(els.profileStatus, "bad", "ANET Profile ID is required.");
      return;
    }

    try {
      const result = await apiFetch(`/api/nft/profile/${encodeURIComponent(uid)}`);
      renderProfile(result.profile);
      renderAssets(result.assets || []);
      setStatus(els.profileStatus, "good", `Profile loaded for ANET Profile ID ${uid}.`);
      if (result.profile?.antsBalance != null) {
        syncAntsAcrossForms(result.profile.antsBalance);
      }
    } catch (error) {
      setStatus(els.profileStatus, "bad", error.message || "Profile load failed.");
    }
  }

  async function onSaveProfile() {
    if (!state.apiReady) {
      setStatus(els.profileStatus, "bad", "Connect NFT API first using Test API.");
      return;
    }
    if (!ensureMinerLoggedIn(els.profileStatus)) {
      return;
    }

    const payload = getProfilePayload();
    if (!payload.uid) {
      setStatus(els.profileStatus, "bad", "ANET Profile ID is required.");
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
      setStatus(els.profileStatus, "good", `Profile saved for ANET Profile ID ${payload.uid}.`);
    } catch (error) {
      setStatus(els.profileStatus, "bad", error.message || "Profile save failed.");
    }
  }

  async function onCreateAsset() {
    if (!state.apiReady) {
      setStatus(els.assetStatusBox, "bad", "Connect NFT API first using Test API.");
      return;
    }
    if (!ensureMinerLoggedIn(els.assetStatusBox)) {
      return;
    }

    const payload = getAssetPayload();
    if (!payload.uid || !payload.name) {
      setStatus(els.assetStatusBox, "bad", "ANET Profile ID and asset name are required.");
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
    if (!state.apiReady) {
      setStatus(els.assetStatusBox, "bad", "Connect NFT API first using Test API.");
      return;
    }
    if (!ensureMinerLoggedIn(els.assetStatusBox)) {
      return;
    }

    const uid = normalizeUid(els.assetUid?.value || els.profileUid?.value || state.minerUid);
    if (!uid) {
      setStatus(els.assetStatusBox, "bad", "ANET Profile ID is required to load assets.");
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
    if (!state.apiReady) {
      if (els.feedList) {
        els.feedList.innerHTML = '<div class="status info">Connect NFT API first, then refresh feed.</div>';
      }
      return;
    }
    try {
      const result = await apiFetch("/api/nft/colony/feed?limit=30");
      renderFeed(result.assets || []);
    } catch (error) {
      if (els.feedList) {
        els.feedList.innerHTML = `<div class="status bad">${escapeHtml(error.message || "Feed load failed")}</div>`;
      }
    }
  }

  async function onCreateMarketListing() {
    if (!state.apiReady) {
      setStatus(els.marketStatus, "bad", "Connect NFT API first using Test API.");
      return;
    }
    if (!ensureMinerLoggedIn(els.marketStatus)) {
      return;
    }

    const payload = getMarketListingPayload();
    if (!payload.uid || !payload.asset_id) {
      setStatus(els.marketStatus, "bad", "Seller ANET Profile ID and Asset ID are required.");
      return;
    }
    if (payload.listing_type === "fixed" && payload.ask_price_ants <= 0) {
      setStatus(els.marketStatus, "bad", "Fixed listing requires ask price > 0.");
      return;
    }
    if (payload.listing_type === "auction" && payload.min_bid_ants <= 0) {
      setStatus(els.marketStatus, "bad", "Auction listing requires minimum bid > 0.");
      return;
    }
    if (payload.listing_type === "domain-auction") {
      const minDomainBid = Number(state.minDomainAuctionBidAnts || 10000);
      if (payload.min_bid_ants < minDomainBid) {
        setStatus(els.marketStatus, "bad", `Domain auction minimum bid is ${minDomainBid} ANTS.`);
        return;
      }
    }

    try {
      const result = await apiFetch("/api/nft/market/listings/create", {
        method: "POST",
        body: payload
      });
      setStatus(
        els.marketStatus,
        "good",
        `Listing created: ${result?.listing?.id || "new listing"}`
      );
      await onLoadMarketListings();
      await onLoadFeed();
    } catch (error) {
      setStatus(els.marketStatus, "bad", error.message || "Failed to create listing.");
    }
  }

  async function onLoadMarketListings() {
    if (!state.apiReady) {
      if (els.marketList) {
        els.marketList.innerHTML = '<div class="status info">Connect NFT API first, then refresh marketplace.</div>';
      }
      return;
    }
    const status = String(els.marketFilterStatus?.value || "active").trim().toLowerCase() || "active";
    const listingType = String(els.marketFilterType?.value || "all").trim().toLowerCase() || "all";

    try {
      const result = await apiFetch(
        `/api/nft/market/listings?status=${encodeURIComponent(status)}&listing_type=${encodeURIComponent(listingType)}&limit=50`
      );
      renderMarketListings(result.listings || []);
      setStatus(els.marketStatus, "good", `Loaded ${result.count || 0} marketplace listings.`);
    } catch (error) {
      if (els.marketList) {
        els.marketList.innerHTML = `<div class="status bad">${escapeHtml(error.message || "Marketplace load failed")}</div>`;
      }
      setStatus(els.marketStatus, "bad", error.message || "Marketplace load failed.");
    }
  }

  // ─── Genesis Collections ─────────────────────────────────────────────────

  async function onLoadCollections() {
    if (!state.apiReady) {
      return;
    }
    try {
      const result = await apiFetch("/api/nft/collections");
      renderCollections(result.collections || []);
    } catch {
      if (els.collectionsList) {
        els.collectionsList.innerHTML = '<div class="status bad">Could not load collections.</div>';
      }
    }
  }

  function renderCollections(collections) {
    if (!els.collectionsList) return;
    if (!collections.length) {
      els.collectionsList.innerHTML = '<div class="status info">No collections yet.</div>';
      return;
    }
    els.collectionsList.innerHTML = collections.map((col) => {
      const pct = col.maxSupply > 0 ? Math.min(100, Math.round((col.currentSupply / col.maxSupply) * 100)) : 0;
      const typeLabel = col.collectionType === "genesis" ? "GENESIS" : col.collectionType === "domain" ? "DOMAIN" : "STANDARD";
      const badgeClass = col.collectionType === "genesis" ? "badge-genesis" : "pill";
      const remaining = col.maxSupply > 0 ? `${col.remaining} remaining` : "Unlimited";
      const soldOutText = col.soldOut ? ' — <strong style="color:var(--danger)">SOLD OUT</strong>' : "";

      return `
        <div class="collection-card">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <strong style="font-family:'Orbitron',sans-serif; font-size:0.85rem;">${escapeHtml(col.name)}</strong>
            <span class="${badgeClass}">${escapeHtml(typeLabel)}</span>
          </div>
          <p class="muted" style="font-size:0.8rem;">${escapeHtml((col.description || "").slice(0, 100))}${(col.description || "").length > 100 ? "…" : ""}</p>
          ${col.maxSupply > 0 ? `
            <div style="display:flex; justify-content:space-between; font-size:0.78rem; color:var(--muted); margin-bottom:4px;">
              <span>${escapeHtml(String(col.currentSupply))} / ${escapeHtml(String(col.maxSupply))} minted</span>
              <span>${escapeHtml(remaining)}${soldOutText}</span>
            </div>
            <div class="supply-bar-track">
              <div class="supply-bar-fill" style="width:${escapeHtmlAttr(String(pct))}%"></div>
            </div>
          ` : `<div class="muted" style="font-size:0.78rem;">Supply: Unlimited</div>`}
        </div>
      `;
    }).join("");
  }

  // ─── Colony Domain Studio ─────────────────────────────────────────────────

  function getDomainPayload() {
    const uid = normalizeUid(els.domainUid?.value || els.profileUid?.value || state.minerUid);
    return {
      uid,
      anet_profile_id: uid,
      domain_name: String(els.domainName?.value || "").trim().toLowerCase(),
      description: String(els.domainDescription?.value || "").trim(),
      colony_description: String(els.domainDescription?.value || "").trim(),
      colony_logo_uri: String(els.domainLogoUri?.value || "").trim(),
      colony_banner_uri: String(els.domainBannerUri?.value || "").trim(),
      image_uri: String(els.domainImageUri?.value || els.domainLogoUri?.value || "").trim(),
      ants_stake: toNumberOrZero(els.domainAntsStake?.value),
      colony_theme: tryParseJson(String(els.domainTheme?.value || "{}").trim() || "{}", {}),
      colony_links: tryParseJson(String(els.domainLinks?.value || "{}").trim() || "{}", {})
    };
  }

  function clearDomainComposer() {
    if (els.domainName) els.domainName.value = "";
    if (els.domainDescription) els.domainDescription.value = "";
    if (els.domainLogoUri) els.domainLogoUri.value = "";
    if (els.domainBannerUri) els.domainBannerUri.value = "";
    if (els.domainImageUri) els.domainImageUri.value = "";
    if (els.domainAntsStake) els.domainAntsStake.value = "0";
    if (els.domainTheme) els.domainTheme.value = "";
    if (els.domainLinks) els.domainLinks.value = "";
  }

  async function onCreateColonyDomain() {
    if (!state.apiReady) {
      setStatus(els.domainStatus, "bad", "Connect NFT API first.");
      return;
    }
    if (!ensureMinerLoggedIn(els.domainStatus)) {
      return;
    }

    const payload = getDomainPayload();
    if (!payload.uid) {
      setStatus(els.domainStatus, "bad", "ANET Profile ID is required.");
      return;
    }
    if (!payload.domain_name) {
      setStatus(els.domainStatus, "bad", "Colony domain name is required.");
      return;
    }

    setStatus(els.domainStatus, "info", "Registering colony domain…");
    try {
      const result = await apiFetch("/api/nft/domains/create", {
        method: "POST",
        body: payload
      });
      setStatus(els.domainStatus, "good", `Colony domain registered: ${result.domainName || result.asset?.name || "domain"}`);
      clearDomainComposer();
      await onLoadColonyDomains();
      await onLoadFeed();
    } catch (error) {
      setStatus(els.domainStatus, "bad", error.message || "Domain registration failed.");
    }
  }

  async function onLoadColonyDomains() {
    if (!state.apiReady) {
      setStatus(els.domainStatus, "bad", "Connect NFT API first.");
      return;
    }
    try {
      const result = await apiFetch("/api/nft/domains?limit=50");
      renderColonyDomains(result.domains || []);
    } catch (error) {
      if (els.domainList) {
        els.domainList.innerHTML = `<div class="status bad">${escapeHtml(error.message || "Could not load domains.")}</div>`;
      }
    }
  }

  function renderColonyDomains(domains) {
    if (!els.domainList) return;
    if (!domains.length) {
      els.domainList.innerHTML = '<div class="status info">No colony domains registered yet. Be the first to build a .ant base!</div>';
      return;
    }

    els.domainList.innerHTML = domains.map((domain) => {
      const name = String(domain.name || domain.domainName || "unknown.ant");
      const owner = String(domain.ownerDisplayName || domain.uid || "unknown");
      const colDesc = String(domain.colony?.description || domain.description || "").trim();
      const logoUri = String(domain.colony?.logoUri || "").trim();
      const bannerUri = String(domain.colony?.bannerUri || "").trim();
      const imageUri = String(domain.imageUri || logoUri || "").trim();
      const assetId = String(domain.id || "").trim();

      const bannerHtml = bannerUri
        ? `<img src="${escapeHtmlAttr(bannerUri)}" class="colony-preview-banner" alt="Colony banner" loading="lazy">`
        : `<div class="colony-preview-banner" style="background:linear-gradient(120deg,rgba(34,231,184,0.12),rgba(88,197,255,0.08));"></div>`;
      const logoHtml = logoUri
        ? `<img src="${escapeHtmlAttr(logoUri)}" class="colony-preview-logo" alt="Colony logo" loading="lazy">`
        : imageUri
          ? `<img src="${escapeHtmlAttr(imageUri)}" class="colony-preview-logo" alt="Colony image" loading="lazy">`
          : `<div class="colony-preview-logo" style="display:flex;align-items:center;justify-content:center;font-size:18px;">&#x1F41C;</div>`;

      const links = domain.colony?.links || {};
      const linksHtml = Object.keys(links).length
        ? `<p class="muted" style="margin-top:4px;font-size:0.78rem;">${Object.entries(links).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`).join(" · ")}</p>`
        : "";

      return `
        <div class="domain-item" data-domain-id="${escapeHtmlAttr(assetId)}">
          <div class="colony-preview-card">
            ${bannerHtml}
            <div class="colony-preview-body">
              ${logoHtml}
              <div class="colony-preview-info">
                <strong>${escapeHtml(name)} <span class="badge-domain">&#x1F41C; .ant</span></strong>
                <p>Owner: ${escapeHtml(owner)}</p>
                ${colDesc ? `<p>${escapeHtml(colDesc.slice(0, 100))}${colDesc.length > 100 ? "…" : ""}</p>` : ""}
                ${linksHtml}
              </div>
            </div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
            <div class="mono" style="font-size:0.74rem;">${escapeHtml(assetId)}</div>
          </div>
          <div class="asset-actions" style="margin-top:8px;">
            <button class="btn btn-alt domain-list-market-btn" type="button">List on Marketplace</button>
          </div>
        </div>
      `;
    }).join("");

    // Wire "List on Marketplace" buttons for domain cards
    Array.from(els.domainList.querySelectorAll(".domain-list-market-btn")).forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".domain-item");
        if (!card) return;
        const domainId = String(card.getAttribute("data-domain-id") || "").trim();
        const uid = normalizeUid(els.domainUid?.value || els.profileUid?.value || state.minerUid);
        if (els.marketAssetId) els.marketAssetId.value = domainId;
        if (els.marketSellerId) els.marketSellerId.value = uid;
        if (els.marketActorId && uid) els.marketActorId.value = uid;
        if (els.marketListingType) {
          els.marketListingType.value = "domain-auction";
          onMarketListingTypeChanged();
        }
        setStatus(els.marketStatus, "info", `Domain ${domainId} prepared for listing. Set your min bid and duration.`);
        els.marketList?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Token Factory — PoS closed-loop ANTS economy
  //
  // Architecture (mirrors EVM token factories but ANTS-denominated):
  //   1. Eligibility gate: caller must have ≥1,000 ANTS staked in the factory
  //      pool. Backend records (uid, staked_ants, last_stake_ts, last_deploy_ts).
  //   2. Deploy: spends 500 ANTS as the deploy fee (sink). Creates a new
  //      token record (factory_token) with name, symbol, supply, decimals,
  //      mintable flag, owner_uid, logo_uri, description.
  //   3. Cooldown: 7 days after each deploy before unstake is allowed
  //      (deters spam + lets governance flag malicious tokens).
  //   4. Slashing (future): governance vote can burn the stake if the
  //      deployed token is fraudulent (impersonation, scam, malware payload).
  //
  // Closed-loop guarantee: factory tokens are tradable on the ANET
  // marketplace and transferable wallet-to-wallet inside the ecosystem,
  // but the factory contract has NO bridge-out path. ANTS stays ANTS.
  // ─────────────────────────────────────────────────────────────────────────

  async function onFactoryRefreshEligibility() {
    if (!state.apiReady) {
      setStatus(els.factoryStakeStatus, "bad", "Connect NFT API first.");
      return;
    }
    if (!ensureNftIdentity(els.factoryStakeStatus)) return;
    const uid = normalizeUid(els.factoryUid?.value || state.minerUid);
    if (!uid) {
      setStatus(els.factoryStakeStatus, "bad", "ANET Profile ID is required.");
      return;
    }
    try {
      const result = await apiFetch(`/api/nft/factory/stake-status?uid=${encodeURIComponent(uid)}`);
      const staked = Number(result.stakedAnts || 0);
      const eligible = Boolean(result.eligible);
      const cooldownUntil = result.cooldownUntil || null;
      state.factoryStakedAnts = staked;
      state.factoryEligible = eligible;
      const cdMsg = cooldownUntil
        ? ` Cooldown until ${new Date(cooldownUntil).toLocaleString()}.`
        : "";
      if (eligible) {
        setStatus(els.factoryStakeStatus, "good", `Eligible. Staked: ${staked.toLocaleString()} ANTS.${cdMsg}`);
      } else {
        setStatus(els.factoryStakeStatus, "info", `Not yet eligible. Staked: ${staked.toLocaleString()} ANTS. Need ≥${state.minFactoryStakeAnts.toLocaleString()}.${cdMsg}`);
      }
      if (els.factoryDeployBtn) {
        els.factoryDeployBtn.disabled = !eligible;
        els.factoryDeployBtn.textContent = eligible ? "Deploy Token" : "Deploy Token (stake required)";
      }
    } catch (error) {
      setStatus(els.factoryStakeStatus, "bad", error.message || "Could not fetch stake status.");
    }
  }

  async function onFactoryStake() {
    if (!state.apiReady) {
      setStatus(els.factoryStakeStatus, "bad", "Connect NFT API first.");
      return;
    }
    if (!ensureNftIdentity(els.factoryStakeStatus)) return;
    const uid = normalizeUid(els.factoryUid?.value || state.minerUid);
    const amount = Math.floor(Number(els.factoryStakeAmount?.value || 0));
    if (!uid) {
      setStatus(els.factoryStakeStatus, "bad", "ANET Profile ID is required.");
      return;
    }
    if (!Number.isFinite(amount) || amount < state.minFactoryStakeAnts) {
      setStatus(els.factoryStakeStatus, "bad", `Minimum stake is ${state.minFactoryStakeAnts.toLocaleString()} ANTS.`);
      return;
    }
    setStatus(els.factoryStakeStatus, "info", "Submitting stake…");
    try {
      const result = await apiFetch("/api/nft/factory/stake", {
        method: "POST",
        body: { uid, amountAnts: amount, profileNftTokenId: state.nftTokenId }
      });
      const staked = Number(result.stakedAnts || amount);
      setStatus(els.factoryStakeStatus, "good", `Staked. Total: ${staked.toLocaleString()} ANTS.`);
      await onFactoryRefreshEligibility();
    } catch (error) {
      setStatus(els.factoryStakeStatus, "bad", error.message || "Stake failed.");
    }
  }

  async function onFactoryUnstake() {
    if (!state.apiReady) {
      setStatus(els.factoryStakeStatus, "bad", "Connect NFT API first.");
      return;
    }
    if (!ensureNftIdentity(els.factoryStakeStatus)) return;
    const uid = normalizeUid(els.factoryUid?.value || state.minerUid);
    if (!uid) {
      setStatus(els.factoryStakeStatus, "bad", "ANET Profile ID is required.");
      return;
    }
    if (!window.confirm(`Unstake your factory ANTS for ${uid}? Eligibility will end immediately. If you are still within the 7-day post-deploy cooldown, this will be rejected by the backend.`)) {
      return;
    }
    setStatus(els.factoryStakeStatus, "info", "Submitting unstake…");
    try {
      const result = await apiFetch("/api/nft/factory/unstake", {
        method: "POST",
        body: { uid, profileNftTokenId: state.nftTokenId }
      });
      const returned = Number(result.returnedAnts || 0);
      setStatus(els.factoryStakeStatus, "good", `Unstaked ${returned.toLocaleString()} ANTS.`);
      await onFactoryRefreshEligibility();
    } catch (error) {
      setStatus(els.factoryStakeStatus, "bad", error.message || "Unstake failed.");
    }
  }

  function getFactoryTokenPayload() {
    const uid = normalizeUid(els.factoryUid?.value || state.minerUid);
    const name = String(els.factoryTokenName?.value || "").trim();
    const symbol = String(els.factoryTokenSymbol?.value || "").trim().toUpperCase();
    const supply = Math.floor(Number(els.factoryTokenSupply?.value || 0));
    const decimals = Math.floor(Number(els.factoryTokenDecimals?.value || 9));
    const description = String(els.factoryTokenDescription?.value || "").trim();
    const logoUri = String(els.factoryTokenLogo?.value || "").trim();
    const mintable = String(els.factoryTokenMintable?.value || "false") === "true";
    // profileNftTokenId binds the deployed token to the deployer's on-chain
    // identity (Public Proof NFT). The backend rejects deploys whose NFT is
    // not active, so a wallet alone is never enough.
    return {
      uid,
      profileNftTokenId: state.nftTokenId,
      name,
      symbol,
      supply,
      decimals,
      description,
      logoUri,
      mintable
    };
  }

  async function onFactoryDeployToken() {
    if (!state.apiReady) {
      setStatus(els.factoryDeployStatus, "bad", "Connect NFT API first.");
      return;
    }
    if (!ensureNftIdentity(els.factoryDeployStatus)) return;
    const payload = getFactoryTokenPayload();
    if (!payload.uid) {
      setStatus(els.factoryDeployStatus, "bad", "ANET Profile ID is required.");
      return;
    }
    if (!payload.name) {
      setStatus(els.factoryDeployStatus, "bad", "Token name is required.");
      return;
    }
    if (!/^[A-Z0-9]{3,6}$/.test(payload.symbol)) {
      setStatus(els.factoryDeployStatus, "bad", "Symbol must be 3–6 uppercase letters/digits.");
      return;
    }
    if (!Number.isFinite(payload.supply) || payload.supply <= 0) {
      setStatus(els.factoryDeployStatus, "bad", "Supply must be a positive integer.");
      return;
    }
    if (payload.decimals < 0 || payload.decimals > 18) {
      setStatus(els.factoryDeployStatus, "bad", "Decimals must be between 0 and 18.");
      return;
    }
    if (!window.confirm(`Deploy ${payload.symbol} (${payload.name})? Fee: ${state.factoryDeployFeeAnts} ANTS. Your stake of ≥${state.minFactoryStakeAnts.toLocaleString()} ANTS will be locked for the 7-day cooldown after deploy.`)) {
      return;
    }
    setStatus(els.factoryDeployStatus, "info", "Deploying token…");
    try {
      const result = await apiFetch("/api/nft/factory/deploy", {
        method: "POST",
        body: payload
      });
      const tokenId = result.tokenId || result.id || "(pending)";
      setStatus(els.factoryDeployStatus, "good", `Deployed ${payload.symbol}. Token id: ${tokenId}.`);
      if (els.factoryTokenName) els.factoryTokenName.value = "";
      if (els.factoryTokenSymbol) els.factoryTokenSymbol.value = "";
      if (els.factoryTokenSupply) els.factoryTokenSupply.value = "";
      if (els.factoryTokenDescription) els.factoryTokenDescription.value = "";
      if (els.factoryTokenLogo) els.factoryTokenLogo.value = "";
      await onFactoryLoadMyTokens();
      await onFactoryRefreshEligibility();
    } catch (error) {
      setStatus(els.factoryDeployStatus, "bad", error.message || "Deploy failed.");
    }
  }

  async function onFactoryLoadMyTokens() {
    if (!state.apiReady) {
      setStatus(els.factoryDeployStatus, "bad", "Connect NFT API first.");
      return;
    }
    const uid = normalizeUid(els.factoryUid?.value || state.minerUid);
    if (!uid) {
      setStatus(els.factoryDeployStatus, "bad", "ANET Profile ID is required.");
      return;
    }
    try {
      const result = await apiFetch(`/api/nft/factory/tokens?uid=${encodeURIComponent(uid)}&limit=50`);
      renderFactoryTokens(result.tokens || []);
    } catch (error) {
      if (els.factoryTokensList) {
        els.factoryTokensList.innerHTML = `<div class="status bad">${escapeHtml(error.message || "Could not load factory tokens.")}</div>`;
      }
    }
  }

  function renderFactoryTokens(tokens) {
    if (!els.factoryTokensList) return;
    if (!tokens.length) {
      els.factoryTokensList.innerHTML = '<div class="status info">No factory tokens deployed yet under this profile.</div>';
      return;
    }
    els.factoryTokensList.innerHTML = tokens.map((t) => {
      const name = String(t.name || "Untitled");
      const symbol = String(t.symbol || "???");
      const supply = Number(t.supply || 0).toLocaleString();
      const decimals = Number(t.decimals || 0);
      const desc = String(t.description || "").trim();
      const logo = String(t.logoUri || "").trim();
      const mintable = t.mintable ? "mintable" : "fixed-supply";
      const deployedAt = t.deployedAt ? new Date(t.deployedAt).toLocaleString() : "—";
      const tokenId = String(t.id || t.tokenId || "").trim();
      const logoHtml = logo
        ? `<img src="${escapeHtmlAttr(logo)}" alt="${escapeHtmlAttr(symbol)} logo" style="width:42px;height:42px;border-radius:8px;object-fit:cover;" loading="lazy">`
        : `<div style="width:42px;height:42px;border-radius:8px;background:rgba(34,231,184,0.12);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">${escapeHtml(symbol.slice(0,3))}</div>`;
      return `
        <div class="domain-item" data-token-id="${escapeHtmlAttr(tokenId)}" style="display:flex;gap:12px;align-items:flex-start;padding:12px;border:1px solid rgba(255,255,255,0.08);border-radius:10px;margin-bottom:8px;">
          ${logoHtml}
          <div style="flex:1;">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap;">
              <strong>${escapeHtml(name)} <span class="accent">($${escapeHtml(symbol)})</span></strong>
              <span class="muted" style="font-size:0.75rem;">${escapeHtml(mintable)} · ${decimals}d · ${escapeHtml(deployedAt)}</span>
            </div>
            <div class="muted" style="font-size:0.82rem;margin-top:4px;">Supply: ${supply}</div>
            ${desc ? `<p style="margin:6px 0 0;font-size:0.85rem;">${escapeHtml(desc)}</p>` : ""}
          </div>
        </div>`;
    }).join("");
  }
})();
