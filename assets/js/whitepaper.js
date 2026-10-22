

// â”€â”€ SIDEBAR ACTIVE LINK â”€â”€
(function() {
  const sections = document.querySelectorAll('.wp-section, .hero');
  const links    = document.querySelectorAll('.nav-item');

  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const id = e.target.id;
        links.forEach(l => {
          l.classList.toggle('active', l.getAttribute('href') === '#' + id);
        });
      }
    });
  }, { rootMargin: '-20% 0px -70% 0px' });

  sections.forEach(s => { if (s.id) observer.observe(s); });
})();

// â”€â”€ SMOOTH SCROLL FOR SIDEBAR LINKS â”€â”€
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

