// Contenu dynamique Franquette : lit les fichiers data/*.json (modifiables via /admin)
// et met à jour les pages. Les valeurs écrites en dur dans le HTML servent de repli
// si le JSON est indisponible.
(function () {
  // Langue de la page : fr (racine) ou en/de/nl/it (sous-dossiers).
  // Pour de/nl/it, les contenus JSON replient sur l'anglais puis le français.
  const LANG = (document.documentElement.lang || 'fr').slice(0, 2);
  const IS_EN = LANG !== 'fr';
  const ROOT = LANG === 'fr' ? '.' : '..';
  const L = (obj, key) => obj[key + '_' + LANG] || (LANG !== 'fr' && obj[key + '_en']) || obj[key];

  const UI_ALL = {
    fr: { locale: 'fr-FR', prix: 'Prix à venir', lire: 'En savoir plus', tout: 'Tout', commander: 'Commander', bientot: 'Bientôt disponible', surplace: 'Également disponible sur place au 8 rue des Dames, Paris 17e.', aucuneActu: 'Pas encore d’actus — revenez vite !', aucunProduit: 'Pas encore de produit dans cette catégorie.', suivre: 'Suivre @franquette_paris', peaufine: 'On peaufine les derniers détails de cette partie de Franquette. Suivez-nous sur Instagram pour être les premiers informés !' },
    en: { locale: 'en-GB', prix: 'Price coming soon', lire: 'Read more', tout: 'All', commander: 'Order', bientot: 'Available soon', surplace: 'Also available in person at 8 rue des Dames, Paris 17th.', aucuneActu: 'No news yet — come back soon!', aucunProduit: 'No products in this category yet.', suivre: 'Follow @franquette_paris', peaufine: 'We are putting the finishing touches to this part of Franquette. Follow us on Instagram to be the first to know!' },
    de: { locale: 'de-DE', prix: 'Preis folgt', lire: 'Mehr lesen', tout: 'Alle', commander: 'Bestellen', bientot: 'Bald verfügbar', surplace: 'Auch vor Ort erhältlich: 8 rue des Dames, Paris 17.', aucuneActu: 'Noch keine Neuigkeiten — bald mehr!', aucunProduit: 'Noch keine Produkte in dieser Kategorie.', suivre: '@franquette_paris folgen', peaufine: 'Wir legen hier letzte Hand an. Folgen Sie uns auf Instagram, um es als Erste zu erfahren!' },
    nl: { locale: 'nl-NL', prix: 'Prijs volgt', lire: 'Lees meer', tout: 'Alles', commander: 'Bestellen', bientot: 'Binnenkort beschikbaar', surplace: 'Ook verkrijgbaar ter plaatse: 8 rue des Dames, Parijs 17e.', aucuneActu: 'Nog geen nieuws — kom snel terug!', aucunProduit: 'Nog geen producten in deze categorie.', suivre: 'Volg @franquette_paris', peaufine: 'We leggen de laatste hand aan dit deel van Franquette. Volg ons op Instagram en weet het als eerste!' },
    it: { locale: 'it-IT', prix: 'Prezzo in arrivo', lire: 'Scopri di più', tout: 'Tutto', commander: 'Ordina', bientot: 'Presto disponibile', surplace: 'Disponibile anche sul posto: 8 rue des Dames, Parigi 17°.', aucuneActu: 'Ancora nessuna novità — torna presto!', aucunProduit: 'Ancora nessun prodotto in questa categoria.', suivre: 'Segui @franquette_paris', peaufine: 'Stiamo rifinendo gli ultimi dettagli di questa parte di Franquette. Seguici su Instagram per saperlo per primi!' }
  };
  const UI = UI_ALL[LANG] || UI_ALL.en;

  const CATEGORIES = {
    vins: { fr: 'Les vins', en: 'Wines', de: 'Weine', nl: 'Wijnen', it: 'Vini', cls: 'card-placeholder-boutique' },
    ceramique: { fr: 'Les céramiques', en: 'Ceramics', de: 'Keramik', nl: 'Keramiek', it: 'Ceramiche', cls: 'card-placeholder-atelier' },
    huile: { fr: "L'huile d'olive", en: 'Olive oil', de: 'Olivenöl', nl: 'Olijfolie', it: 'Olio d’oliva', cls: 'card-placeholder-cafe' },
    cafe: { fr: 'Le café', en: 'Coffee', de: 'Kaffee', nl: 'Koffie', it: 'Caffè', cls: 'card-placeholder-boutique' },
    cadeau: { fr: 'Bons cadeaux', en: 'Gift vouchers', de: 'Gutscheine', nl: 'Cadeaubonnen', it: 'Buoni regalo', cls: 'card-placeholder-atelier' }
  };
  const catLabel = (c) => { const o = CATEGORIES[c] || {}; return o[LANG] || o.en || o.fr || c; };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const prixTxt = (p) => p == null
    ? UI.prix
    : (LANG === 'fr' ? p.toFixed(2).replace('.', ',') + ' €' : '€' + p.toFixed(2));
  const dateTxt = (iso) => {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString(UI.locale, { day: 'numeric', month: 'long', year: 'numeric' });
  };
  const getJSON = (path) => fetch(ROOT + '/' + path, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(path); return r.json(); });

  // ---------- Infos pratiques (site.json) ----------
  getJSON('data/site.json').then((site) => {
    document.querySelectorAll('a[href^="tel:"]').forEach((a) => {
      a.href = site.contact.tel_href;
      if (/\d/.test(a.textContent)) a.textContent = site.contact.telephone;
    });
    document.querySelectorAll('a[href^="mailto:"]:not(.email-fixe)').forEach((a) => {
      const suffix = a.getAttribute('href').includes('?') ? a.getAttribute('href').slice(a.getAttribute('href').indexOf('?')) : '';
      a.href = 'mailto:' + site.contact.email + suffix;
      if (a.textContent.includes('@')) a.textContent = site.contact.email;
    });
    document.querySelectorAll('a[href*="restaurantfranquette.fr"]').forEach((a) => { a.href = site.liens.reservation; });
    document.querySelectorAll('a[href*="uniiti.com"]').forEach((a) => { a.href = site.liens.bons_cadeaux; });
    document.querySelectorAll('a[href*="instagram.com"]').forEach((a) => { a.href = site.liens.instagram; });
    document.querySelectorAll('a[href*="facebook.com"]').forEach((a) => { a.href = site.liens.facebook; });
    document.querySelectorAll('[data-bind-html]').forEach((el) => {
      const lire = (chemin) => chemin.split('.').reduce((o, k) => (o ? o[k] : null), site);
      const chemin = el.getAttribute('data-bind-html');
      // Les pages DE/NL/IT demandent leur langue (cafe_de…) et retombent sur l'anglais sinon.
      const val = lire(chemin) || lire(chemin.replace(/_(de|nl|it)$/, '_en'));
      if (val) el.innerHTML = val;
    });

    // ---------- Rubriques en mode « à venir » (activables depuis /admin) ----------
    const R = site.rubriques || {};
    const soonMsg = IS_EN ? (R.message_en || 'Opening soon') : (R.message_fr || 'Ouverture prochainement');

    const pageOff =
      (document.body.classList.contains('theme-boutique') && R.boutique === false) ||
      (document.body.classList.contains('theme-atelier') && R.ateliers === false);

    if (pageOff) {
      document.querySelectorAll('section:not(.hero)').forEach((s) => s.remove());
      const heroBtn = document.querySelector('.hero .btn');
      if (heroBtn) heroBtn.remove();
      const sec = document.createElement('section');
      sec.innerHTML = '<div class="container" style="text-align:center;">' +
        '<h2 class="section-title">' + esc(soonMsg) + '</h2><hr class="divider">' +
        '<p class="section-sub">' + UI.peaufine + '</p>' +
        '<p style="text-align:center;"><a class="btn dark" href="' + esc((site.liens && site.liens.instagram) || '#') + '" target="_blank" rel="noopener">' +
        UI.suivre + '</a></p></div>';
      const footer = document.querySelector('footer');
      footer.parentNode.insertBefore(sec, footer);
    }

    // Badge « à venir » sur les cartes de l'accueil
    const badgeCard = (href) => {
      document.querySelectorAll('.univers-card[href="' + href + '"] .card-body').forEach((b) => {
        b.insertAdjacentHTML('beforeend', '<span class="badge-soon">' + esc(soonMsg) + '</span>');
      });
    };
    if (R.boutique === false) badgeCard('boutique.html');
    if (R.ateliers === false) badgeCard('ateliers.html');
  }).catch(() => {});

  // ---------- Textes de page éditables depuis /admin ----------
  if (document.querySelector('[data-txt]')) {
    getJSON('data/textes.json').then((T) => {
      document.querySelectorAll('[data-txt]').forEach((el) => {
        const entry = T[el.getAttribute('data-txt')];
        if (!entry) return;
        const val = entry[LANG];
        if (val != null && String(val).trim() !== '') el.innerHTML = val;
      });
    }).catch(() => {});
  }

  // ---------- Avis clients ----------
  const avisGrid = document.getElementById('avis-grid');
  if (avisGrid) {
    getJSON('data/avis.json').then((data) => {
      const chiffre = document.getElementById('avis-chiffre');
      const count = document.getElementById('avis-count');
      const source = document.getElementById('avis-source');
      const etoiles = document.getElementById('avis-etoiles');
      if (chiffre) chiffre.textContent = String(data.note_moyenne).replace('.', IS_EN ? '.' : ',') + '/5';
      if (count) count.textContent = data.nombre_avis;
      if (source) source.href = data.source_url;
      if (etoiles) etoiles.textContent = '★★★★★☆'.slice(0, Math.round(data.note_moyenne)) || '★★★★★';
      avisGrid.innerHTML = (data.avis || []).map((a) =>
        '<div class="avis-card"><div class="avis-etoiles">' + '★'.repeat(a.note) + '</div>' +
        '<p>&laquo;&nbsp;' + esc(L(a, 'texte')) + '&nbsp;&raquo;</p>' +
        '<p class="avis-auteur">' + esc(a.auteur) +
        (a.date ? ' &middot; ' + esc(new Date(a.date).toLocaleDateString(LANG, { day: 'numeric', month: 'long', year: 'numeric' })) : '') +
        '</p></div>'
      ).join('');
    }).catch(() => {});
  }

  // ---------- Actualités ----------
  const renderActu = (a) => {
    const img = a.image
      ? '<img src="' + esc(ROOT + '/' + a.image) + '" alt="" loading="lazy">'
      : '';
    const lien = a.lien
      ? '<a href="' + esc(a.lien) + '" target="_blank" rel="noopener">' + esc((LANG === 'fr' && a.lien_texte) || UI.lire) + ' →</a>'
      : '';
    return '<article class="actu-card">' + img +
      '<div class="actu-body"><p class="actu-date">' + esc(dateTxt(a.date)) + '</p>' +
      '<h3>' + esc(L(a, 'titre')) + '</h3>' +
      '<p>' + esc(L(a, 'texte')) + '</p>' + lien + '</div></article>';
  };

  const actuList = document.getElementById('actus-list');
  const actuHome = document.getElementById('actus-home');
  if (actuList || actuHome) {
    getJSON('data/actus.json').then((actus) => {
      actus.sort((a, b) => b.date.localeCompare(a.date));
      if (actuList) {
        actuList.innerHTML = actus.length
          ? actus.map(renderActu).join('')
          : '<p class="notice">' + UI.aucuneActu + '</p>';
      }
      if (actuHome && actus.length) {
        actuHome.innerHTML = actus.slice(0, 3).map(renderActu).join('');
        const wrap = document.getElementById('actus-home-wrap');
        if (wrap) wrap.hidden = false;
      }
    }).catch(() => {});
  }

  // ---------- Boutique : grille ----------
  const grid = document.getElementById('produits-grid');
  if (grid) {
    getJSON('data/produits.json').then((produits) => {
      const chips = document.getElementById('filter-chips');
      const cats = [...new Set(produits.map((p) => p.categorie))];
      let current = 'tous';

      const cardImg = (p) => p.image
        ? 'style="background-image:url(\'' + esc(ROOT + '/' + p.image) + '\')"'
        : 'class="produit-visuel ' + (CATEGORIES[p.categorie] || {}).cls + '"';

      const render = () => {
        const list = produits.filter((p) => p.dispo !== false && (current === 'tous' || p.categorie === current));
        grid.innerHTML = list.map((p) =>
          '<a href="' + (IS_EN ? 'produit.html' : 'produit.html') + '?id=' + encodeURIComponent(p.id) + '" class="produit-card">' +
          '<div class="produit-visuel" ' + (p.image ? 'style="background-image:url(\'' + esc(ROOT + '/' + p.image) + '\')"' : '') + '>' +
          (p.image ? '' : '<span class="produit-visuel-badge ' + ((CATEGORIES[p.categorie] || {}).cls || '') + '"></span>') +
          '</div>' +
          '<div class="produit-body"><p class="produit-cat">' + esc(catLabel(p.categorie)) + '</p>' +
          '<h3>' + esc(L(p, 'nom')) + '</h3>' +
          '<p class="produit-prix">' + prixTxt(p.prix) + '</p></div></a>'
        ).join('') || '<p class="notice">' + UI.aucunProduit + '</p>';
      };

      if (chips) {
        chips.innerHTML = ['tous', ...cats].map((c) =>
          '<button class="chip' + (c === 'tous' ? ' active' : '') + '" data-cat="' + esc(c) + '">' +
          esc(c === 'tous' ? UI.tout : (catLabel(c))) + '</button>'
        ).join('');
        chips.addEventListener('click', (e) => {
          const b = e.target.closest('.chip');
          if (!b) return;
          current = b.dataset.cat;
          chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === b));
          render();
        });
      }
      render();
    }).catch(() => {});
  }

  // ---------- Boutique : page produit ----------
  const detail = document.getElementById('produit-detail');
  if (detail) {
    const id = new URLSearchParams(location.search).get('id');
    getJSON('data/produits.json').then((produits) => {
      const p = produits.find((x) => x.id === id) || produits[0];
      if (!p) return;
      document.title = L(p, 'nom') + ' — Franquette';
      document.querySelectorAll('.langs a[href]').forEach((a) => {
        a.href = a.getAttribute('href').split('?')[0] + '?id=' + encodeURIComponent(p.id);
      });

      const achat = p.stripe
        ? '<a href="' + esc(p.stripe) + '" class="btn solid" target="_blank" rel="noopener">' + UI.commander + '</a>'
        : '<button class="btn dark" disabled style="opacity:.5;cursor:not-allowed;">' + UI.bientot + '</button>';

      detail.innerHTML =
        '<div class="produit-visuel produit-visuel-grand" ' + (p.image ? 'style="background-image:url(\'' + esc(ROOT + '/' + p.image) + '\')"' : '') + '>' +
        (p.image ? '' : '<span class="produit-visuel-badge ' + ((CATEGORIES[p.categorie] || {}).cls || '') + '"></span>') + '</div>' +
        '<div><p class="produit-cat">' + esc(catLabel(p.categorie)) + '</p>' +
        '<h1 class="produit-titre">' + esc(L(p, 'nom')) + '</h1>' +
        '<p class="produit-prix produit-prix-grand">' + prixTxt(p.prix) + '</p>' +
        '<p class="produit-desc">' + esc(L(p, 'description')) + '</p>' +
        '<div style="margin-top:1.6rem;">' + achat + '</div>' +
        '<p style="margin-top:1.2rem;font-size:.85rem;color:#6b6b6b;">' +
        UI.surplace + '</p></div>';

      const ld = {
        '@context': 'https://schema.org', '@type': 'Product',
        name: L(p, 'nom'), description: L(p, 'description'),
        brand: { '@type': 'Brand', name: 'Franquette' }
      };
      if (p.prix != null) ld.offers = { '@type': 'Offer', price: p.prix, priceCurrency: 'EUR', availability: 'https://schema.org/InStock' };
      const s = document.createElement('script');
      s.type = 'application/ld+json';
      s.textContent = JSON.stringify(ld);
      document.head.appendChild(s);
    }).catch(() => {});
  }
})();
