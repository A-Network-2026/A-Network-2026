    const canvas = document.getElementById('ants-bg');
    const ctx = canvas.getContext('2d');

    function resize() {
      canvas.width = innerWidth;
      canvas.height = innerHeight;
    }

    resize();
    window.addEventListener('resize', resize);

    const tunnelNodes = [];
    const ants = [];
    const antColors = ['#6ae7b1', '#59c9ff', '#d3ff78', '#ffc35d'];

    for (let i = 0; i < 70; i += 1) {
      tunnelNodes.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.28,
        vy: (Math.random() - 0.5) * 0.28,
      });
    }

    for (let i = 0; i < 34; i += 1) {
      ants.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 1.4,
        vy: (Math.random() - 0.5) * 1.4,
        hue: antColors[i % antColors.length],
      });
    }

    function drawAnt(ant) {
      ctx.save();
      ctx.translate(ant.x, ant.y);
      ctx.rotate(Math.atan2(ant.vy, ant.vx));
      ctx.strokeStyle = ant.hue;
      ctx.lineWidth = 1.2;

      ctx.beginPath();
      ctx.arc(-4, 0, 1.6, 0, Math.PI * 2);
      ctx.arc(0, 0, 1.3, 0, Math.PI * 2);
      ctx.arc(4, 0, 2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(2, -2);
      ctx.lineTo(5, -5);
      ctx.moveTo(2, 2);
      ctx.lineTo(5, 5);
      ctx.moveTo(-1, -2.5);
      ctx.lineTo(-3.5, -5);
      ctx.moveTo(-1, 2.5);
      ctx.lineTo(-3.5, 5);
      ctx.moveTo(4, -1.5);
      ctx.lineTo(7.5, -4);
      ctx.moveTo(4, 1.5);
      ctx.lineTo(7.5, 4);
      ctx.stroke();

      ctx.restore();
    }

    function animate() {
      ctx.fillStyle = 'rgba(4, 16, 25, 0.24)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < tunnelNodes.length; i += 1) {
        const node = tunnelNodes[i];
        node.x += node.vx;
        node.y += node.vy;

        if (node.x < 0 || node.x > canvas.width) node.vx *= -1;
        if (node.y < 0 || node.y > canvas.height) node.vy *= -1;

        ctx.beginPath();
        ctx.arc(node.x, node.y, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(106, 231, 177, 0.56)';
        ctx.fill();

        for (let j = i + 1; j < tunnelNodes.length; j += 1) {
          const other = tunnelNodes[j];
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < 130) {
            ctx.strokeStyle = `rgba(89, 201, 255, ${0.08 * (1 - distance / 130)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(other.x, other.y);
            ctx.stroke();
          }
        }
      }

      for (const ant of ants) {
        ant.x += ant.vx;
        ant.y += ant.vy;

        if (ant.x < 12 || ant.x > canvas.width - 12) ant.vx *= -1;
        if (ant.y < 12 || ant.y > canvas.height - 12) ant.vy *= -1;

        if (Math.random() < 0.02) {
          ant.vx += (Math.random() - 0.5) * 0.7;
          ant.vy += (Math.random() - 0.5) * 0.7;
        }

        const speed = Math.max(0.6, Math.min(1.8, Math.hypot(ant.vx, ant.vy)));
        ant.vx = (ant.vx / Math.hypot(ant.vx, ant.vy || 1)) * speed;
        ant.vy = (ant.vy / Math.hypot(ant.vx || 1, ant.vy)) * speed;

        drawAnt(ant);
      }

      requestAnimationFrame(animate);
    }

    animate();
  

