(() => {
  const MINING_API = 'https://rmp-site.onrender.com/public/miners';
  const MAINNET_API = 'https://explorer.a-network.net';
  const PAGE_SIZE = 50;
  let offset = 0;
  let sort = 'sessions';
  let miners = [];
  let summary = null;

  const elements = {
    body: document.getElementById('miners-body'),
    filter: document.getElementById('filter-input'),
    sort: document.getElementById('sort-select'),
    prev: document.getElementById('prev-button'),
    next: document.getElementById('next-button'),
    page: document.getElementById('page-label'),
    activity: document.getElementById('activity-panel'),
    loadState: document.getElementById('load-state'),
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function formatCount(value) {
    return Number(value || 0).toLocaleString();
  }

  function formatDate(value) {
    if (!value) return 'No session recorded';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date unavailable';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function shortWallet(wallet) {
    const value = String(wallet || '');
    return value.length > 24 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
  }

  async function loadDirectory() {
    elements.body.innerHTML = '<tr><td colspan="6" class="empty">Loading miner records…</td></tr>';
    elements.loadState.textContent = 'Refreshing public data…';
    const url = new URL(MINING_API);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('sort', sort);

    try {
      const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Miner service returned HTTP ${response.status}`);
      const data = await response.json();
      miners = Array.isArray(data.miners) ? data.miners : [];
      summary = data.summary || {};
      renderMetrics();
      renderMiners();
      elements.loadState.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      elements.body.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(error.message || 'Miner data is unavailable right now.')}</td></tr>`;
      elements.page.textContent = 'Directory unavailable';
      elements.prev.disabled = true;
      elements.next.disabled = true;
      elements.loadState.textContent = 'Data unavailable';
    }
  }

  function renderMetrics() {
    document.getElementById('metric-miners').textContent = formatCount(summary.total_miners);
    document.getElementById('metric-active').textContent = formatCount(summary.active_miners);
    document.getElementById('metric-sessions').textContent = formatCount(summary.reported_sessions);
    document.getElementById('metric-updated').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function renderMiners() {
    const term = elements.filter.value.trim().toLowerCase();
    const visible = miners.filter((miner) => `${miner.miner} ${miner.wallet_address || ''}`.toLowerCase().includes(term));
    if (!visible.length) {
      elements.body.innerHTML = `<tr><td colspan="6" class="empty">${term ? 'No matches on this page.' : 'No miner records found.'}</td></tr>`;
    } else {
      elements.body.innerHTML = visible.map((miner) => {
        const originalIndex = miners.indexOf(miner);
        const sessions = Number(miner.successful_sessions || 0);
        const percent = Math.min(100, Math.max(0, Number(miner.eligibility_percent || 0)));
        const latest = miner.recent_sessions?.[0]?.started_at || miner.last_mining_start;
        const rank = offset + originalIndex + 1;
        return `<tr>
          <td><span class="rank">${formatCount(rank)}</span> <button type="button" class="miner-name detail-button" data-miner-index="${originalIndex}">${escapeHtml(shortWallet(miner.miner))}</button></td>
          <td><span class="status ${miner.is_mining ? 'active' : ''}">${miner.is_mining ? 'Mining' : 'Idle'}</span></td>
          <td class="sessions">${formatCount(sessions)} / 1,000</td>
          <td><span class="progress"><i style="width:${percent}%"></i></span><span class="progress-label">${percent.toFixed(1)}%</span></td>
          <td class="date">${escapeHtml(formatDate(latest))}</td>
          <td><button type="button" class="detail-button" data-miner-index="${originalIndex}">Details</button></td>
        </tr>`;
      }).join('');
    }

    const total = Number(summary.total_miners || 0);
    const first = total ? offset + 1 : 0;
    const last = Math.min(offset + PAGE_SIZE, total);
    elements.page.textContent = term
      ? `${visible.length} matches on this page · ${first} to ${last} of ${formatCount(total)}`
      : `${first} to ${last} of ${formatCount(total)} miners`;
    elements.prev.disabled = offset === 0;
    elements.next.disabled = offset + PAGE_SIZE >= total;
  }

  async function showActivity(miner) {
    elements.activity.hidden = false;
    document.getElementById('activity-title').textContent = shortWallet(miner.miner);
    document.getElementById('activity-source').textContent = miner.wallet_address
      ? 'Session history comes from the mining service. The mainnet record is checked separately.'
      : 'This miner has no public wallet linked, so there is no mainnet record to check.';

    const sessions = document.getElementById('session-list');
    const history = Array.isArray(miner.recent_sessions) ? miner.recent_sessions : [];
    sessions.innerHTML = history.length
      ? history.map((session) => `<li><span>${session.completed ? 'Session completed' : escapeHtml(session.status || 'Session activity')}</span><time>${escapeHtml(formatDate(session.started_at))}</time></li>`).join('')
      : '<li><span>No recent session rows</span><time>No timestamp</time></li>';

    const chain = document.getElementById('chain-record');
    if (!miner.wallet_address) {
      chain.textContent = 'A public wallet address is not linked to this miner record.';
    } else {
      const wallet = miner.wallet_address;
      const proofUrl = `${MAINNET_API}/sessions/proof/${encodeURIComponent(wallet)}`;
      const activityUrl = `${MAINNET_API}/accounts/${encodeURIComponent(wallet)}/activity?limit=10`;
      chain.innerHTML = 'Checking the mainnet record';
      try {
        const response = await fetch(proofUrl, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (!response.ok) throw new Error(response.status === 404 ? 'No committed proof is currently available for this wallet.' : `Mainnet returned HTTP ${response.status}.`);
        const proof = await response.json();
        chain.innerHTML = `<span class="chain-value">${formatCount(proof.sessions)} sessions recorded on mainnet</span><p>Mainnet inclusion proof. Root: <span class="date">${escapeHtml(String(proof.root || '').slice(0, 18))}…</span></p><a href="${escapeHtml(proofUrl)}" target="_blank" rel="noopener">View proof</a><a href="${escapeHtml(activityUrl)}" target="_blank" rel="noopener">View wallet activity</a>`;
      } catch (error) {
        chain.innerHTML = `<p>${escapeHtml(error.message || 'Mainnet proof could not be loaded.')}</p><a href="${escapeHtml(proofUrl)}" target="_blank" rel="noopener">Open proof endpoint ↗</a><a href="${escapeHtml(activityUrl)}" target="_blank" rel="noopener">View wallet activity</a>`;
      }
    }
    elements.activity.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  elements.body.addEventListener('click', (event) => {
    const button = event.target.closest('[data-miner-index]');
    if (button) showActivity(miners[Number(button.dataset.minerIndex)]);
  });
  elements.filter.addEventListener('input', renderMiners);
  elements.sort.addEventListener('change', () => {
    sort = elements.sort.value;
    offset = 0;
    loadDirectory();
  });
  elements.prev.addEventListener('click', () => {
    offset = Math.max(0, offset - PAGE_SIZE);
    loadDirectory();
  });
  elements.next.addEventListener('click', () => {
    offset += PAGE_SIZE;
    loadDirectory();
  });
  document.getElementById('refresh-button').addEventListener('click', loadDirectory);
  document.getElementById('close-activity').addEventListener('click', () => { elements.activity.hidden = true; });
  elements.sort.value = sort;
  loadDirectory();
})();