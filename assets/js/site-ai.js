"use strict";

(function initANetworkAssistant() {
  const PAGE_SOURCES = [
    { file: "index.html", label: "Home" },
    { file: "ants-program.html", label: "ANTS Program" },
    { file: "web4.html", label: "Web4" },
    { file: "whitepaper.html", label: "Whitepaper" },
    { file: "nft.html", label: "NFT Explorer" },
    { file: "privacy.html", label: "Privacy Policy" },
    { file: "terms.html", label: "Terms of Service" }
  ];
  const SUPPORT_EMAIL = "info@a-network.net";
  const MAX_ANSWER_CHARS = 700;

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
  appendMessage("assistant", "Hello. Ask me about ANTS mining, the ANET token, Web4, NFTs, or the whitepaper.");

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
        #anet-site-ai { position: fixed; right: 20px; bottom: 20px; z-index: 99999; font-family: Roboto, Arial, sans-serif; color: #202124; }
        #anet-site-ai * { box-sizing: border-box; }
        #anet-site-ai button, #anet-site-ai input, #anet-site-ai textarea, #anet-site-ai summary { font: inherit; }
        #anet-site-ai .ai-toggle { display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 18px 0 14px; border: 1px solid #dadce0; border-radius: 22px; background: #ffffff; color: #1a73e8; font-size: 14px; font-weight: 500; cursor: pointer; box-shadow: 0 1px 3px rgba(60, 64, 67, 0.3); }
        #anet-site-ai .ai-toggle:hover { background: #f8f9fa; }
        #anet-site-ai .ai-toggle:focus-visible, #anet-site-ai .ai-icon-btn:focus-visible, #anet-site-ai .ai-send:focus-visible, #anet-site-ai summary:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }
        #anet-site-ai .ai-toggle svg { width: 20px; height: 20px; fill: currentColor; flex: none; }
        #anet-site-ai.open .ai-toggle { display: none; }
        #anet-site-ai .ai-panel { display: none; flex-direction: column; width: min(380px, calc(100vw - 24px)); height: min(560px, calc(100vh - 40px)); background: #ffffff; border: 1px solid #dadce0; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(60, 64, 67, 0.3); }
        #anet-site-ai.open .ai-panel { display: flex; }
        #anet-site-ai .ai-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 8px 12px 16px; border-bottom: 1px solid #dadce0; }
        #anet-site-ai .ai-title { margin: 0; font-size: 16px; font-weight: 500; color: #202124; line-height: 1.3; }
        #anet-site-ai .ai-sub { margin: 2px 0 0; font-size: 12px; color: #5f6368; line-height: 1.3; }
        #anet-site-ai .ai-icon-btn { width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; color: #5f6368; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
        #anet-site-ai .ai-icon-btn:hover { background: #f1f3f4; }
        #anet-site-ai .ai-icon-btn svg { width: 20px; height: 20px; fill: currentColor; }
        #anet-site-ai .ai-feed { flex: 1; min-height: 0; padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
        #anet-site-ai .ai-msg { max-width: 88%; padding: 10px 14px; border-radius: 8px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
        #anet-site-ai .ai-msg.assistant { align-self: flex-start; background: #f1f3f4; color: #202124; }
        #anet-site-ai .ai-msg.user { align-self: flex-end; background: #e8f0fe; color: #174ea6; }
        #anet-site-ai .ai-msg.system { align-self: stretch; max-width: 100%; background: #fef7e0; color: #5f4b00; font-size: 13px; }
        #anet-site-ai .ai-source { display: block; margin-top: 6px; font-size: 12px; color: #5f6368; }
        #anet-site-ai .ai-source a { color: #1a73e8; text-decoration: none; }
        #anet-site-ai .ai-source a:hover { text-decoration: underline; }
        #anet-site-ai .ai-input-wrap { display: flex; align-items: center; gap: 8px; padding: 12px 12px 12px 16px; border-top: 1px solid #dadce0; }
        #anet-site-ai .ai-input { flex: 1; min-width: 0; height: 40px; padding: 0 14px; border: 1px solid #dadce0; border-radius: 20px; background: #ffffff; color: #202124; font-size: 14px; }
        #anet-site-ai .ai-input::placeholder { color: #5f6368; }
        #anet-site-ai .ai-input:focus { outline: none; border-color: #1a73e8; box-shadow: 0 0 0 1px #1a73e8; }
        #anet-site-ai .ai-send { width: 40px; height: 40px; border: 0; border-radius: 50%; background: #1a73e8; color: #ffffff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex: none; }
        #anet-site-ai .ai-send:hover { background: #1967d2; }
        #anet-site-ai .ai-send svg { width: 18px; height: 18px; fill: currentColor; }
        #anet-site-ai .ai-members { border-top: 1px solid #dadce0; }
        #anet-site-ai .ai-members summary { padding: 10px 16px; font-size: 13px; color: #5f6368; cursor: pointer; list-style: none; }
        #anet-site-ai .ai-members summary::-webkit-details-marker { display: none; }
        #anet-site-ai .ai-members summary:hover { background: #f8f9fa; }
        #anet-site-ai .ai-members-body { display: grid; gap: 8px; padding: 4px 16px 14px; max-height: 240px; overflow-y: auto; }
        #anet-site-ai .ai-field { width: 100%; padding: 8px 10px; border: 1px solid #dadce0; border-radius: 4px; background: #ffffff; color: #202124; font-size: 13px; }
        #anet-site-ai .ai-field:focus { outline: none; border-color: #1a73e8; box-shadow: 0 0 0 1px #1a73e8; }
        #anet-site-ai textarea.ai-field { min-height: 56px; resize: vertical; }
        #anet-site-ai .ai-row { display: flex; gap: 8px; flex-wrap: wrap; }
        #anet-site-ai .ai-btn { padding: 7px 14px; border: 1px solid #dadce0; border-radius: 4px; background: #ffffff; color: #1a73e8; font-size: 13px; font-weight: 500; cursor: pointer; }
        #anet-site-ai .ai-btn:hover { background: #f8f9fa; }
        #anet-site-ai .ai-btn.main { background: #1a73e8; border-color: #1a73e8; color: #ffffff; }
        #anet-site-ai .ai-btn.main:hover { background: #1967d2; }
        @media (max-width: 480px) { #anet-site-ai { right: 12px; bottom: 12px; } }
      </style>
      <button class="ai-toggle" id="anet-ai-toggle" type="button" aria-label="Open A Network AI" aria-expanded="false" aria-controls="anet-ai-panel">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg>
        <span>A Network AI</span>
      </button>
      <section class="ai-panel" id="anet-ai-panel" role="dialog" aria-label="A Network AI">
        <div class="ai-head">
          <div>
            <h2 class="ai-title">A Network AI</h2>
            <p class="ai-sub">Answers from A Network documentation</p>
          </div>
          <button class="ai-icon-btn" id="anet-ai-close" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div class="ai-feed" id="anet-ai-feed" aria-live="polite"></div>
        <div class="ai-input-wrap">
          <input class="ai-input" id="anet-ai-input" type="text" placeholder="Ask a question" aria-label="Ask a question" autocomplete="off">
          <button class="ai-send" id="anet-ai-send" type="button" aria-label="Send">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
        <details class="ai-members">
          <summary>Member tools</summary>
          <div class="ai-members-body">
            <input class="ai-field" id="anet-ai-uid" type="text" placeholder="ANET Profile ID" aria-label="ANET Profile ID">
            <input class="ai-field" id="anet-ai-username" type="text" placeholder="Username" aria-label="Username">
            <input class="ai-field" id="anet-ai-wallet" type="text" placeholder="Wallet address" aria-label="Wallet address">
            <div class="ai-row">
              <button class="ai-btn main" id="anet-ai-login" type="button">Sign in with wallet</button>
              <button class="ai-btn" id="anet-ai-load-public" type="button">Refresh answers</button>
            </div>
            <textarea class="ai-field" id="anet-ai-train-q" placeholder="Question" aria-label="Question"></textarea>
            <textarea class="ai-field" id="anet-ai-train-a" placeholder="Suggested answer" aria-label="Suggested answer"></textarea>
            <div class="ai-row">
              <button class="ai-btn" id="anet-ai-submit-train" type="button">Submit for review</button>
            </div>
          </div>
        </details>
      </section>
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

  function setOpen(open) {
    state.open = open;
    els.root.classList.toggle("open", open);
    els.toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      els.input.focus();
    } else {
      els.toggle.focus();
    }
  }

  function wireEvents() {
    els.toggle.addEventListener("click", async () => {
      setOpen(true);
      if (!state.ready) {
        await ensureKnowledgeLoaded();
        await syncPublicTraining(true);
      }
    });

    els.close.addEventListener("click", () => setOpen(false));
    els.root.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.open) {
        setOpen(false);
      }
    });

    els.send.addEventListener("click", onAsk);
    els.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onAsk();
      }
    });

    els.login.addEventListener("click", onWalletLogin);
    els.loadPublic.addEventListener("click", () => syncPublicTraining(false));
    els.submitTrain.addEventListener("click", onSubmitTraining);
  }

  function hydrateLoginFields() {
    els.uid.value = state.minerUid;
    els.username.value = state.minerUsername;
    els.wallet.value = state.walletAddress;
  }

  function appendMessage(kind, text, source) {
    const box = document.createElement("div");
    box.className = `ai-msg ${kind}`;
    box.textContent = String(text || "").trim();
    if (source && source.file) {
      const note = document.createElement("span");
      note.className = "ai-source";
      note.append("Source: ");
      const link = document.createElement("a");
      link.href = source.file;
      link.textContent = source.label;
      note.appendChild(link);
      box.appendChild(note);
    }
    els.feed.appendChild(box);
    els.feed.scrollTop = els.feed.scrollHeight;
  }

  async function ensureKnowledgeLoaded() {
    if (state.ready || state.loadingKnowledge) {
      return;
    }
    state.loadingKnowledge = true;

    const chunks = [];
    for (const source of PAGE_SOURCES) {
      try {
        const response = await fetch(source.file, { cache: "no-store" });
        if (!response.ok) {
          continue;
        }
        const html = await response.text();
        chunks.push(...extractChunksFromHtml(source, html));
      } catch {
        // continue with the pages that are available
      }
    }

    state.pageChunks = chunks;
    state.ready = true;
    state.loadingKnowledge = false;
  }

  function extractChunksFromHtml(source, html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    Array.from(doc.querySelectorAll("script, style, noscript, nav, footer")).forEach((node) => node.remove());

    const title = (doc.querySelector("title")?.textContent || "").trim();
    const headers = Array.from(doc.querySelectorAll("h1, h2, h3")).map((n) => (n.textContent || "").trim()).filter(Boolean);
    const paragraphs = Array.from(doc.querySelectorAll("p, li"))
      .map((n) => (n.textContent || "").replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 40);

    const lines = [title, ...headers, ...paragraphs].filter(Boolean);
    const chunks = [];
    let current = "";
    for (const line of lines) {
      if ((current + " " + line).length > 420) {
        if (current) {
          chunks.push({ source, text: current });
        }
        current = line;
      } else {
        current = current ? `${current} ${line}` : line;
      }
    }
    if (current) {
      chunks.push({ source, text: current });
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
    const { text, source } = buildGroundedAnswer(question);
    appendMessage("assistant", text, source);
  }

  function buildGroundedAnswer(question) {
    const tokens = String(question || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3);

    const rows = [];
    for (const row of state.trainingExamples) {
      rows.push({ source: null, text: `${row.prompt} ${row.response}`, response: row.response, weight: 3 });
    }
    for (const row of state.pageChunks) {
      rows.push({ source: row.source, text: row.text, response: row.text, weight: 1 });
    }

    const best = rows
      .map((row) => {
        const haystack = row.text.toLowerCase();
        let score = 0;
        for (const token of tokens) {
          if (haystack.includes(token)) {
            score += row.weight;
          }
        }
        return { ...row, score };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)[0];

    if (!best) {
      return {
        text: `I could not find that in the A Network documentation. Try rephrasing the question, or contact ${SUPPORT_EMAIL}.`,
        source: null
      };
    }

    let answer = String(best.response || "").replace(/\s+/g, " ").trim();
    if (answer.length > MAX_ANSWER_CHARS) {
      answer = `${answer.slice(0, MAX_ANSWER_CHARS).replace(/\s+\S*$/, "")}...`;
    }
    return { text: answer, source: best.source };
  }

  async function onWalletLogin() {
    const uid = String(els.uid.value || "").trim();
    const username = String(els.username.value || "").trim();
    const walletAddress = String(els.wallet.value || "").trim().toUpperCase();

    if (!uid || !username || !walletAddress) {
      appendMessage("system", "Enter your ANET Profile ID, username, and wallet address to sign in.");
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
        throw new Error(payload.error || `Sign in failed (${response.status})`);
      }

      state.sessionToken = String(payload.sessionToken);
      state.minerUid = uid;
      state.minerUsername = username;
      state.walletAddress = walletAddress;

      localStorage.setItem("anet_ai_session_token", state.sessionToken);
      localStorage.setItem("anet_ai_uid", uid);
      localStorage.setItem("anet_ai_username", username);
      localStorage.setItem("anet_ai_wallet", walletAddress);

      appendMessage("system", "Signed in. You can now submit suggested answers for review.");
    } catch (error) {
      appendMessage("system", error.message || "Sign in failed.");
    }
  }

  async function syncPublicTraining(quiet) {
    try {
      const response = await fetch(`${state.apiBase}/api/ai/training/public`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `Refresh failed (${response.status})`);
      }
      state.trainingExamples = Array.isArray(payload.examples) ? payload.examples : [];
      if (!quiet) {
        appendMessage("system", "Answers refreshed.");
      }
    } catch (error) {
      if (!quiet) {
        appendMessage("system", error.message || "Could not refresh answers.");
      }
    }
  }

  async function onSubmitTraining() {
    const prompt = String(els.trainQ.value || "").trim();
    const responseText = String(els.trainA.value || "").trim();

    if (!prompt || !responseText) {
      appendMessage("system", "Enter both a question and a suggested answer.");
      return;
    }
    if (!state.sessionToken || !state.minerUid) {
      appendMessage("system", "Sign in with your wallet before submitting.");
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
        throw new Error(payload.error || `Submission failed (${response.status})`);
      }

      els.trainQ.value = "";
      els.trainA.value = "";
      appendMessage(
        "system",
        payload.queuedForOwnerApproval
          ? "Submitted. It will appear after review."
          : "Submitted and published."
      );
      await syncPublicTraining(true);
    } catch (error) {
      appendMessage("system", error.message || "Submission failed.");
    }
  }
})();
