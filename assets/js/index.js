    const c = document.getElementById('bg');
    const ctx = c.getContext('2d');

    function resize() {
      c.width = innerWidth;
      c.height = innerHeight;
    }

    resize();
    window.addEventListener('resize', resize);

    const nodes = [];
    for (let i = 0; i < 90; i++) {
      nodes.push({
        x: Math.random() * c.width,
        y: Math.random() * c.height,
        vx: (Math.random() - 0.5) * 0.28,
        vy: (Math.random() - 0.5) * 0.28
      });
    }

    function animate() {
      ctx.fillStyle = 'rgba(5, 11, 18, 0.32)';
      ctx.fillRect(0, 0, c.width, c.height);

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        node.x += node.vx;
        node.y += node.vy;

        if (node.x < 0 || node.x > c.width) node.vx *= -1;
        if (node.y < 0 || node.y > c.height) node.vy *= -1;

        ctx.beginPath();
        ctx.arc(node.x, node.y, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = '#58c5ff';
        ctx.fill();

        for (let j = i + 1; j < nodes.length; j++) {
          const other = nodes[j];
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < 120) {
            ctx.strokeStyle = `rgba(88, 197, 255, ${0.08 * (1 - distance / 120)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(other.x, other.y);
            ctx.stroke();
          }
        }
      }

      requestAnimationFrame(animate);
    }

    animate();

    let provider;
    let signer;
    let userAddress;

    const tokenAddress = '0x791055A7d52AA392eaE8De04250497f33807E46A';
    const pairAddress = '0xb90071e377a31a6ea2cfdebe19a4d5226c420b6b';
    const abi = [
      'function balanceOf(address owner) view returns (uint256)',
      'function decimals() view returns (uint8)'
    ];

    async function connectWallet() {
      if (!window.ethereum) {
        alert('Install MetaMask or another compatible wallet.');
        return;
      }

      provider = new ethers.providers.Web3Provider(window.ethereum);

      try {
        await provider.send('eth_requestAccounts', []);
        await provider.send('wallet_switchEthereumChain', [{ chainId: '0x38' }]);
      } catch (err) {
        if (err.code === 4902) {
          await provider.send('wallet_addEthereumChain', [{
            chainId: '0x38',
            chainName: 'BNB Smart Chain',
            nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
            rpcUrls: ['https://bsc-dataseed.binance.org/'],
            blockExplorerUrls: ['https://bscscan.com']
          }]);
        } else {
          console.error(err);
          return;
        }
      }

      signer = provider.getSigner();
      userAddress = await signer.getAddress();
      document.getElementById('wallet').innerText = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
      await getBalance();
    }

    async function getBalance() {
      try {
        if (!provider || !userAddress) {
          alert('Connect wallet first');
          return;
        }

        const network = await provider.getNetwork();
        if (network.chainId !== 56) {
          alert('Switch to BNB Smart Chain');
          return;
        }

        const contract = new ethers.Contract(tokenAddress, abi, provider);
        const balance = await contract.balanceOf(userAddress);
        const decimals = await contract.decimals();
        const formatted = Number(ethers.utils.formatUnits(balance, decimals));
        document.getElementById('balance').innerText = formatted.toLocaleString(undefined, { maximumFractionDigits: 4 });
      } catch (e) {
        console.error(e);
        alert('Failed to fetch balance');
      }
    }

    async function getPrice() {
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/bsc/${pairAddress}`);
        const data = await res.json();
        const usd = Number(data?.pair?.priceUsd || 0);
        document.getElementById('price').innerText = usd ? `$${usd.toFixed(4)}` : 'Unavailable';
      } catch (e) {
        console.error(e);
        document.getElementById('price').innerText = 'Unavailable';
      }
    }

    getPrice();

    if (window.ethereum) {
      window.ethereum.on('chainChanged', () => location.reload());
      window.ethereum.on('accountsChanged', () => location.reload());
    }
  

