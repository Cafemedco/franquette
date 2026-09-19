// Menu mobile
const burger = document.querySelector('.burger');
const navList = document.querySelector('nav ul');

if (burger && navList) {
  burger.addEventListener('click', () => {
    navList.classList.toggle('open');
  });

  navList.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => navList.classList.remove('open'));
  });
}

// Animation du bandeau au défilement : le texte glisse et s'efface, la photo se décale doucement
const heroEl = document.querySelector('.hero');
if (heroEl && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const heroContent = heroEl.querySelector('.hero-content');
  let heroTicking = false;
  const updateHero = () => {
    const h = heroEl.offsetHeight || 1;
    const y = Math.min(window.scrollY, h);
    const p = y / h;
    heroEl.style.backgroundPosition = 'center ' + (50 + p * 50) + '%';
    if (heroContent) {
      heroContent.style.transform = 'translateY(' + (y * 0.3) + 'px)';
      heroContent.style.opacity = String(Math.max(0, 1 - p * 1.3));
    }
    heroTicking = false;
  };
  window.addEventListener('scroll', () => {
    if (!heroTicking) { heroTicking = true; requestAnimationFrame(updateHero); }
  }, { passive: true });
  updateHero();
}

// Apparition en douceur des sections au défilement
const revealTargets = document.querySelectorAll('section:not(.hero)');
if (revealTargets.length && 'IntersectionObserver' in window) {
  revealTargets.forEach((el) => el.classList.add('reveal'));
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealTargets.forEach((el) => revealObserver.observe(el));
}

// Apparition échelonnée des éléments (photos, cartes, plats, séparateurs)
const itemSel = 'section:not(.hero) img, section:not(.hero) .menu-item, section:not(.hero) .contact-band-grid > div, section:not(.hero) .infos-grid > div, section:not(.hero) .actu-card, section:not(.hero) hr.divider';
function revealItems(root) {
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('rv-in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });
  root.querySelectorAll(itemSel).forEach((el) => {
    if (el.classList.contains('rv-item')) return;
    el.classList.add('rv-item');
    const sibs = el.parentElement ? [...el.parentElement.children] : [];
    el.style.setProperty('--rv-delay', Math.min(sibs.indexOf(el), 5) * 90 + 'ms');
    io.observe(el);
  });
}
revealItems(document);
let rvTimer;
new MutationObserver(() => { clearTimeout(rvTimer); rvTimer = setTimeout(() => revealItems(document), 80); })
  .observe(document.body, { childList: true, subtree: true });

// Onglets de carte (café) : un clic par catégorie
document.querySelectorAll('.carte-tabs').forEach((tabs) => {
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    tabs.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === b));
    const scope = tabs.closest('.container') || document;
    scope.querySelectorAll('.carte-pane').forEach((p) => p.classList.toggle('hidden-pane', p.dataset.pane !== b.dataset.carte));
  });
});
