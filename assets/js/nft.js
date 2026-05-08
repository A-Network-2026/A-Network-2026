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

    kpiMinAnts: document.getElementById("kpi-min-ants"),
    kpiFeedCount: document.getElementById("kpi-feed-count"),
    kpiMyAssets: document.getElementById("kpi-my-assets")
  };

  const state = {
    apiBase: resolveInitialApiBase(),
    minAnts: 1000,
    minDomainAuctionBidAnts: 10000,
    myAssets: [],
    marketListings: [],
    apiReady: false
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
    els.marketCreateBtn?.addEventListener("click", onCreateMarketListing);
    els.marketRefreshBtn?.addEventListener("click", onLoadMarketListings);
    els.marketListingType?.addEventListener("change", onMarketListingTypeChanged);
    els.marketFilterStatus?.addEventListener("change", onLoadMarketListings);
    els.marketFilterType?.addEventListener("change", onLoadMarketListings);
  }

  async function bootstrap() {
    onMarketListingTypeChanged();
    const connected = await onTestApi();
    if (connected) {
      await onLoadFeed();
      await onLoadMarketListings();
    }
  }

  function resolveInitialApiBase() {
    const fromQuery = String(new URLSearchParams(window.location.search).get("api") || "").trim();
    if (fromQuery) {
      return fromQuery.replace(/\/$/, "");
    }

    const saved = String(localStorage.getItem("anet_nft_api_base") || "").trim();
    if (saved) {
      return saved;
    }

    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      return "http://localhost:3001";
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
    if (els.marketSellerId) els.marketSellerId.value = uid;
    if (els.marketActorId) els.marketActorId.value = uid;
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
    const sellerId = normalizeUid(els.marketSellerId?.value || els.profileUid?.value);
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
    return normalizeUid(els.marketActorId?.value || els.profileUid?.value);
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

  function renderMarketListings(items) {
    state.marketListings = Array.isArray(items) ? items : [];
    if (!els.marketList) return;

    if (!state.marketListings.length) {
      els.marketList.innerHTML = '<div class="status info">No marketplace listings found for selected filter.</div>';
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
        <article class="asset-item" data-listing-id="${escapeHtmlAttr(listing.id || "")}">
          <div class="asset-head">
            <strong>${escapeHtml(assetName)}</strong>
            <span class="pill">${escapeHtml(status)}</span>
          </div>
          <div class="asset-head" style="margin-top:4px;">
            <span class="pill">${escapeHtml(listingTypeLabel)}</span>
            ${expiredBadge}
          </div>
          <div class="mono">Listing: ${escapeHtml(listing.id || "")}</div>
          <div class="mono">Asset: ${escapeHtml(listing.assetId || "")}</div>
          <p class="muted" style="margin-top:7px;">Seller: ${escapeHtml(owner)} | ${escapeHtml(timeText)}</p>
          <p class="muted" style="margin-top:7px;">
            Ask: ${escapeHtml(String(ask))} ANTS | Min Bid: ${escapeHtml(String(minBid))} ANTS | Buy Now: ${escapeHtml(String(buyNow))} ANTS
          </p>
          <p class="muted" style="margin-top:7px;">Highest Bid: ${escapeHtml(String(highest))} ANTS (${escapeHtml(String(bidCount))} bids)</p>
          ${marketActions}
          <div class="status info market-inline-status" style="display:none; margin-top:8px;"></div>
        </article>
      `;
    }).join("");

    const cards = Array.from(els.marketList.querySelectorAll(".asset-item"));
    cards.forEach((card) => {
      const listingId = String(card.getAttribute("data-listing-id") || "").trim();
      const statusBox = card.querySelector(".market-inline-status");

      const setInline = (type, message) => {
        if (!statusBox) return;
        statusBox.style.display = "block";
        statusBox.className = `status ${type} market-inline-status`;
        statusBox.textContent = message;
      };

      card.querySelector(".market-bid-btn")?.addEventListener("click", async () => {
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
      setStatus(els.apiStatus, "bad", "Please enter API base URL (backend domain). Example: https://your-backend.onrender.com");
      return;
    }

    saveApiBase(base);
    setStatus(els.apiStatus, "good", `Saved API base URL: ${base}`);
  }

  async function onTestApi() {
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
      return true;
    } catch (error) {
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

    const uid = normalizeUid(els.profileUid?.value);
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

    const uid = normalizeUid(els.assetUid?.value || els.profileUid?.value);
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
})();
