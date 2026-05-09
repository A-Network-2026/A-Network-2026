"use strict";

(function initANetworkSiteAI() {
  const AI_ICON_PATH = "assets/ai-assistant-icon.svg";
  const PAGE_SOURCES = [
    "index.html",
    "ants-program.html",
    "web4.html",
    "whitepaper.html",
    "nft.html",
    "privacy.html",
    "terms.html"
  ];

  const state = {
    open: false,
    ready: false,
    loadingKnowledge: false,
    pageChunks: [],
    trainingExamples: [],
    sessionToken: localStorage.getItem("anet_ai_session_token") || "",
    minerUid: localStorage.getItem("anet_ai_uid") || "",
    minerUsername: localStorage.getItem("anet_ai_username") || "",
    walletAddress: localStorage.getItem("anet_ai_wallet") || "",
    apiBase: resolveApiBase()
  };

  const els = buildWidget();
  wireEvents();
  hydrateLoginFields();
  appendMessage("assistant", "A Network AI is online. Ask about any page, NFT utility, Web4, ANTS Program, or ecosystem rules.");

  function resolveApiBase() {
    if (window.location.hostname === "a-network.net" || window.location.hostname === "www.a-network.net") {
      return "https://pi-backend-q2ye.onrender.com";
    }
    const saved = String(localStorage.getItem("anet_nft_api_base") || "").trim();
    if (saved) {
      return saved.replace(/\/$/, "");
    }
    return window.location.origin;
  }

  function buildWidget() {
    const root = document.createElement("div");
    root.id = "anet-site-ai";
    root.innerHTML = `
      <style>
        #anet-site-ai { position: fixed; right: 16px; bottom: 16px; z-index: 99999; font-family: "Space Grotesk", sans-serif; }
        #anet-site-ai .ai-toggle { border: 1px solid rgba(88,197,255,.45); background: linear-gradient(120deg, #22e7b8, #58c5ff); color: #04213a; font-weight: 800; border-radius: 999px; padding: 8px 14px 8px 8px; cursor: pointer; box-shadow: 0 12px 34px rgba(0,0,0,.35); display: inline-flex; align-items: center; gap: 8px; }
        #anet-site-ai .ai-toggle:hover { transform: translateY(-1px); box-shadow: 0 18px 40px rgba(0,0,0,.42); }
        #anet-site-ai .ai-toggle-avatar { width: 30px; height: 30px; border-radius: 999px; border: 1px solid rgba(4, 33, 58, 0.35); object-fit: cover; box-shadow: 0 0 0 2px rgba(255,255,255,0.16); }
        #anet-site-ai .ai-toggle-text { letter-spacing: .02em; }
        #anet-site-ai .ai-panel { display: none; width: min(420px, calc(100vw - 28px)); height: min(640px, calc(100vh - 90px)); background: rgba(5, 14, 24, 0.97); border: 1px solid rgba(88,197,255,.28); border-radius: 14px; overflow: hidden; box-shadow: 0 20px 70px rgba(0,0,0,.55); }
        #anet-site-ai.open .ai-panel { display: grid; grid-template-rows: auto 1fr auto auto; }
        #anet-site-ai .ai-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding: 10px 12px; background: rgba(88,197,255,.08); border-bottom:1px solid rgba(88,197,255,.2); }
        #anet-site-ai .ai-head-left { display: flex; align-items: center; gap: 9px; min-width: 0; }
        #anet-site-ai .ai-head-avatar { width: 34px; height: 34px; border-radius: 10px; border:1px solid rgba(88,197,255,.35); object-fit: cover; flex-shrink: 0; box-shadow: 0 0 0 2px rgba(88,197,255,.15); }
        #anet-site-ai .ai-title { margin: 0; font-family: "Orbitron", sans-serif; font-size: .9rem; letter-spacing: .04em; color:#eff6ff; }
        #anet-site-ai .ai-sub { margin: 2px 0 0; color:#9eb2c9; font-size:.74rem; }
        #anet-site-ai .ai-close { border:1px solid rgba(88,197,255,.3); background:transparent; color:#eff6ff; border-radius:8px; padding:6px 8px; cursor:pointer; }
        #anet-site-ai .ai-feed { padding: 10px; overflow:auto; display:grid; gap:8px; align-content:start; }
        #anet-site-ai .ai-msg { border:1px solid rgba(88,197,255,.18); border-radius: 10px; padding: 8px 10px; font-size:.84rem; line-height:1.45; color:#eff6ff; white-space: pre-wrap; }
        #anet-site-ai .ai-msg.user { background: rgba(34,231,184,.12); border-color: rgba(34,231,184,.3); }
        #anet-site-ai .ai-msg.assistant { background: rgba(88,197,255,.08); }
        #anet-site-ai .ai-msg.system { background: rgba(255,188,92,.1); border-color: rgba(255,188,92,.28); color: #ffe7c1; }
        #anet-site-ai .ai-input-wrap { padding: 10px; border-top:1px solid rgba(88,197,255,.2); display:grid; grid-template-columns: 1fr auto; gap:8px; }
        #anet-site-ai .ai-input { border:1px solid rgba(88,197,255,.35); background:#06111d; color:#eff6ff; border-radius:10px; padding:10px; font-size:.84rem; }
        #anet-site-ai .ai-send { border:1px solid rgba(88,197,255,.45); background: linear-gradient(120deg, #58c5ff, #31a9ff); color:#04213a; font-weight:700; border-radius:10px; padding:10px 12px; cursor:pointer; }
        #anet-site-ai .ai-login { border-top:1px solid rgba(88,197,255,.2); padding: 10px; display:grid; gap:7px; }
        #anet-site-ai .ai-login-grid { display:grid; grid-template-columns: 1fr 1fr; gap:7px; }
        #anet-site-ai .ai-login input, #anet-site-ai .ai-login textarea { border:1px solid rgba(88,197,255,.3); background:#06111d; color:#eff6ff; border-radius:9px; padding:8px; font-size:.8rem; }
        #anet-site-ai .ai-login textarea { min-height: 54px; resize: vertical; grid-column: 1 / -1; }
        #anet-site-ai .ai-row { display:flex; gap:7px; flex-wrap: wrap; }
        #anet-site-ai .ai-btn { border:1px solid rgba(88,197,255,.35); background: transparent; color:#eff6ff; border-radius:8px; padding:7px 9px; cursor:pointer; font-size:.78rem; }
        #anet-site-ai .ai-btn.main { background: rgba(34,231,184,.15); border-color: rgba(34,231,184,.45); color:#d8fff3; }
      </style>
      <button class="ai-toggle" id="anet-ai-toggle" type="button" aria-label="Open A Network AI">
        <img class="ai-toggle-avatar" src="${AI_ICON_PATH}" alt="A Network AI icon" loading="lazy">
        <span class="ai-toggle-text">A Network AI</span>
      </button>
      <div class="ai-panel" id="anet-ai-panel" aria-live="polite">
        <div class="ai-head">
          <div class="ai-head-left">
            <img class="ai-head-avatar" src="${AI_ICON_PATH}" alt="A Network AI avatar" loading="lazy">
            <div>
              <p class="ai-title">A Network AI</p>
              <p class="ai-sub">Grounded on your site pages + approved training</p>
            </div>
          </div>
          <button class="ai-close" id="anet-ai-close" type="button">Close</button>
        </div>
        <div class="ai-feed" id="anet-ai-feed"></div>
        <div class="ai-input-wrap">
          <input class="ai-input" id="anet-ai-input" type="text" placeholder="Ask about ANTS, Web4, NFT, roadmap, policy...">
          <button class="ai-send" id="anet-ai-send" type="button">Ask</button>
        </div>
        <div class="ai-login">
          <div class="ai-login-grid">
            <input id="anet-ai-uid" type="text" placeholder="ANET Profile ID">
            <input id="anet-ai-username" type="text" placeholder="Username">
            <input id="anet-ai-wallet" type="text" placeholder="Wallet Address" style="grid-column:1 / -1;">
          </div>
          <div class="ai-row">
            <button class="ai-btn main" id="anet-ai-login" type="button">Wallet Login</button>
            <button class="ai-btn" id="anet-ai-load-public" type="button">Sync Public Training</button>
          </div>
          <textarea id="anet-ai-train-q" placeholder="Training Q: What should AI answer?"></textarea>
          <textarea id="anet-ai-train-a" placeholder="Training A: Approved answer for users"></textarea>
          <div class="ai-row">
            <button class="ai-btn" id="anet-ai-submit-train" type="button">Submit Training</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    return {
      root,
      panel: root.querySelector("#anet-ai-panel"),
      toggle: root.querySelector("#anet-ai-toggle"),
      close: root.querySelector("#anet-ai-close"),
      feed: root.querySelector("#anet-ai-feed"),
      input: root.querySelector("#anet-ai-input"),
      send: root.querySelector("#anet-ai-send"),
      uid: root.querySelector("#anet-ai-uid"),
      username: root.querySelector("#anet-ai-username"),
      wallet: root.querySelector("#anet-ai-wallet"),
      login: root.querySelector("#anet-ai-login"),
      loadPublic: root.querySelector("#anet-ai-load-public"),
      trainQ: root.querySelector("#anet-ai-train-q"),
      trainA: root.querySelector("#anet-ai-train-a"),
      submitTrain: root.querySelector("#anet-ai-submit-train")
    };
  }

  function wireEvents() {
    els.toggle.addEventListener("click", async () => {
      state.open = !state.open;
      els.root.classList.toggle("open", state.open);
      if (state.open && !state.ready) {
        await ensureKnowledgeLoaded();
        await syncPublicTraining();
      }
    });

    els.close.addEventListener("click", () => {
      state.open = false;
      els.root.classList.remove("open");
    });

    els.send.addEventListener("click", onAsk);
    els.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onAsk();
      }
    });

    els.login.addEventListener("click", onWalletLogin);
    els.loadPublic.addEventListener("click", syncPublicTraining);
    els.submitTrain.addEventListener("click", onSubmitTraining);
  }

  function hydrateLoginFields() {
    els.uid.value = state.minerUid;
    els.username.value = state.minerUsername;
    els.wallet.value = state.walletAddress;
  }

  function appendMessage(kind, text) {
    const box = document.createElement("div");
    box.className = `ai-msg ${kind}`;
    box.textContent = String(text || "").trim();
    els.feed.appendChild(box);
    els.feed.scrollTop = els.feed.scrollHeight;
  }

  async function ensureKnowledgeLoaded() {
    if (state.ready || state.loadingKnowledge) {
      return;
    }
    state.loadingKnowledge = true;
    appendMessage("system", "Syncing page knowledge from your website...");

    const chunks = [];
    for (const page of PAGE_SOURCES) {
      try {
        const response = await fetch(page, { cache: "no-store" });
        if (!response.ok) {
          continue;
        }
        const html = await response.text();
        const pageChunks = extractChunksFromHtml(page, html);
        chunks.push(...pageChunks);
      } catch {
        // continue with available pages
      }
    }

    state.pageChunks = chunks;
    state.ready = true;
    state.loadingKnowledge = false;
    appendMessage("system", `Knowledge synced from ${chunks.length} content chunks across site pages.`);
  }

  function extractChunksFromHtml(page, html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    Array.from(doc.querySelectorAll("script, style, noscript")).forEach((n) => n.remove());

    const title = (doc.querySelector("title")?.textContent || "").trim();
    const headers = Array.from(doc.querySelectorAll("h1, h2, h3")).map((n) => (n.textContent || "").trim()).filter(Boolean);
    const paragraphs = Array.from(doc.querySelectorAll("p, li")).map((n) => (n.textContent || "").replace(/\s+/g, " ").trim()).filter((line) => line.length > 40);

    const lines = [title, ...headers, ...paragraphs].filter(Boolean);
    const chunks = [];

    let current = "";
    for (const line of lines) {
      if ((current + " " + line).length > 420) {
        if (current) {
          chunks.push({ page, text: current });
        }
        current = line;
      } else {
        current = current ? `${current} ${line}` : line;
      }
    }
    if (current) {
      chunks.push({ page, text: current });
    }

    return chunks;
  }

  async function onAsk() {
    const question = String(els.input.value || "").trim();
    if (!question) {
      return;
    }
    els.input.value = "";
    appendMessage("user", question);

    await ensureKnowledgeLoaded();

    if (/admob|adsense|ads|advert/i.test(question)) {
      const adsAnswer = [
        "AdMob is for mobile apps, while website pages normally use AdSense.",
        "It is not prohibited to run ads, but policy compliance is required: no invalid traffic, no forced clicks, and clear privacy disclosure.",
        "For your app: keep app-ads.txt valid and use approved production ad units only after account approval.",
        "For your website: use AdSense tags, not AdMob SDK."
      ].join("\n");
      appendMessage("assistant", adsAnswer);
      return;
    }

    const answer = buildGroundedAnswer(question);
    appendMessage("assistant", answer);
  }

  function buildGroundedAnswer(question) {
    const tokens = String(question || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3);

    const sourceRows = [];

    for (const row of state.trainingExamples) {
      sourceRows.push({
        page: row.sourcePage || "community-training",
        text: `${row.prompt} ${row.response}`,
        response: row.response,
        isTraining: true
      });
    }

    for (const row of state.pageChunks) {
      sourceRows.push({ page: row.page, text: row.text, response: row.text, isTraining: false });
    }

    const scored = sourceRows
      .map((row) => {
        const t = row.text.toLowerCase();
        let score = 0;
        for (const token of tokens) {
          if (t.includes(token)) {
            score += row.isTraining ? 3 : 1;
          }
        }
        return { ...row, score };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    if (!scored.length) {
      return "I could not find a strong page-grounded match yet. Try adding more details or submit a training Q/A below after wallet login.";
    }

    const body = scored.map((row, idx) => `${idx + 1}. (${row.page}) ${row.response}`).join("\n\n");
    return `Grounded answer from A Network sources:\n\n${body}`;
  }

  async function onWalletLogin() {
    const uid = String(els.uid.value || "").trim();
    const username = String(els.username.value || "").trim();
    const walletAddress = String(els.wallet.value || "").trim().toUpperCase();

    if (!uid || !username || !walletAddress) {
      appendMessage("system", "Wallet login needs ANET Profile ID, username, and wallet address.");
      return;
    }

    try {
      const response = await fetch(`${state.apiBase}/api/nft/auth/miner-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, username, wallet_address: walletAddress })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false || !payload.sessionToken) {
        throw new Error(payload.error || `Login failed (${response.status})`);
      }

      state.sessionToken = String(payload.sessionToken);
      state.minerUid = uid;
      state.minerUsername = username;
      state.walletAddress = walletAddress;

      localStorage.setItem("anet_ai_session_token", state.sessionToken);
      localStorage.setItem("anet_ai_uid", uid);
      localStorage.setItem("anet_ai_username", username);
      localStorage.setItem("anet_ai_wallet", walletAddress);

      appendMessage("system", `Wallet login success for ${walletAddress}. You can now submit AI training entries.`);
    } catch (error) {
      appendMessage("system", error.message || "Wallet login failed.");
    }
  }

  async function syncPublicTraining() {
    try {
      const response = await fetch(`${state.apiBase}/api/ai/training/public`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `Training sync failed (${response.status})`);
      }
      state.trainingExamples = Array.isArray(payload.examples) ? payload.examples : [];
      appendMessage("system", `Synced ${state.trainingExamples.length} owner-approved training entries.`);
    } catch (error) {
      appendMessage("system", error.message || "Could not sync public training entries.");
    }
  }

  async function onSubmitTraining() {
    const prompt = String(els.trainQ.value || "").trim();
    const responseText = String(els.trainA.value || "").trim();

    if (!prompt || !responseText) {
      appendMessage("system", "Enter both Training Q and Training A first.");
      return;
    }
    if (!state.sessionToken || !state.minerUid) {
      appendMessage("system", "Wallet login is required before training submission.");
      return;
    }

    try {
      const response = await fetch(`${state.apiBase}/api/ai/training/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ANET-MINER-SESSION": state.sessionToken
        },
        body: JSON.stringify({
          uid: state.minerUid,
          anet_profile_id: state.minerUid,
          source_page: window.location.pathname.replace(/^\//, "") || "index.html",
          prompt,
          response: responseText,
          tags: [{ trait_type: "channel", value: "site-ai" }],
          is_public: true
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `Training submit failed (${response.status})`);
      }

      els.trainQ.value = "";
      els.trainA.value = "";

      if (payload.queuedForOwnerApproval) {
        appendMessage("system", "Training submitted. It is queued for AI owner approval before becoming public.");
      } else {
        appendMessage("system", "Training submitted and published by owner wallet.");
      }
      await syncPublicTraining();
    } catch (error) {
      appendMessage("system", error.message || "Training submission failed.");
    }
  }
})();
