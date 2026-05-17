    const EXPLORER_API_BASE = 'https://explorer.a-network.net';

    function escapeHtml(str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    }

    function buildApiUrl(path) {
      return new URL(path, `${EXPLORER_API_BASE}/`).toString();
    }

    function formatCount(value) {
      return Number(value || 0).toLocaleString();
    }

    function formatCadence(seconds) {
      if (!seconds && seconds !== 0) return 'Unknown';
      if (seconds === 1) return '1 Second Settlement Window';
      if (seconds < 60) return `${seconds} Second Settlement Windows`;
      if (seconds === 60) return '1 Minute Settlement Window';
      if (seconds < 3600) return `${Math.floor(seconds / 60)} Minute Settlement Windows`;
      return `${Math.floor(seconds / 3600)} Hour Settlement Windows`;
    }

    async function fetchLiveData() {
      const errorBox = document.getElementById('errorBox');
      try {
        const [blocksRes, statsRes] = await Promise.all([
          fetch(buildApiUrl('blocks'), { cache: 'no-store' }),
          fetch(buildApiUrl('stats/investor'), {
            cache: 'no-store',
            headers: { 'Accept': 'application/json' }
          })
        ]);

        if (!blocksRes.ok || !statsRes.ok) {
          throw new Error('Failed to load live network data from explorer.a-network.net');
        }

        const blocks = await blocksRes.json();
        const investor = await statsRes.json();
        const latestBlock = Array.isArray(blocks) && blocks.length ? blocks[blocks.length - 1] : null;

        document.getElementById('blockCount').textContent = latestBlock ? `#${latestBlock.block_height}` : 'Pending';
        document.getElementById('sessionCount').textContent = formatCount(investor.metrics?.total_sessions);
        document.getElementById('minerCount').textContent = formatCount(investor.metrics?.total_active_miners);
        document.getElementById('activatedSupply').textContent = `${investor.activated_supply_anet || '0'} ANET`;
        const cadenceSeconds = latestBlock
          ? Math.max(1, Math.round((new Date(latestBlock.epoch_end) - new Date(latestBlock.epoch_start)) / 1000))
          : null;
        document.getElementById('cadence').textContent = formatCadence(cadenceSeconds);
        document.getElementById('epochEnd').textContent = investor.current_epoch_end || 'Unavailable';

        const body = document.getElementById('blocksBody');
        body.innerHTML = '';

        const recentBlocks = Array.isArray(blocks) ? blocks.slice(-12).reverse() : [];
        if (!recentBlocks.length) {
          body.innerHTML = '<tr><td colspan="5" class="muted">No settlement blocks yet. A block appears when transfers or newly synchronized Web2 supply need settlement.</td></tr>';
          return;
        }

        for (const block of recentBlocks) {
          const row = document.createElement('tr');
          row.innerHTML = `
            <td><span class="kicker">Block #${escapeHtml(block.block_height)}</span></td>
            <td class="mono">${escapeHtml(block.hash)}</td>
            <td>${formatCount(block.miners?.length || 0)}</td>
            <td>${formatCount(block.transactions?.length || 0)}</td>
            <td class="mono">${escapeHtml(block.epoch_end)}</td>
          `;
          body.appendChild(row);
        }

        errorBox.style.display = 'none';
      } catch (error) {
        errorBox.textContent = error.message || 'Failed to load live network data from explorer.a-network.net';
        errorBox.style.display = 'block';
        document.getElementById('blocksBody').innerHTML = '<tr><td colspan="5" class="muted">Live feed unavailable.</td></tr>';
      }
    }

    fetchLiveData();
    setInterval(fetchLiveData, 5000);
  

