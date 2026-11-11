// Anti-« clickjacking » : la page d'administration refuse de s'afficher dans le cadre d'un autre site.
if (window.top !== window.self) {
  document.documentElement.innerHTML = '';
  throw new Error('Administration affichée dans un cadre : bloquée.');
}

(function () {
  const $ = (id) => document.getElementById(id);
  const escA = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const API = 'https://api.github.com';
  let AUTH = null; // {owner, repo, token}
  let SITE = null, ACTUS = [], PRODUITS = [], AVIS = null;
  let TEXTES = {};
  let SHAS = {};   // path -> sha
  let editActu = null, editProd = null, editAvis = null;

  const status = (msg, err) => {
    const el = $('status');
    el.textContent = msg;
    el.style.background = err ? '#a33' : 'var(--bleu)';
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
  };

  const b64encode = (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  };
  const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));

  const gh = async (path, opts = {}) => {
    const r = await fetch(API + path, Object.assign({}, opts, {
      headers: Object.assign({
        'Authorization': 'Bearer ' + AUTH.token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }, opts.headers || {})
    }));
    if (!r.ok) throw new Error('GitHub ' + r.status + ' — ' + (await r.text()).slice(0, 200));
    return r.status === 204 ? null : r.json();
  };

  const loadFile = async (path) => {
    const d = await gh('/repos/' + AUTH.owner + '/' + AUTH.repo + '/contents/' + path + '?ref=main&t=' + Date.now());
    SHAS[path] = d.sha;
    return JSON.parse(b64decode(d.content));
  };

  const saveFile = async (path, obj, message) => {
    const body = { message: 'admin : ' + message, content: b64encode(JSON.stringify(obj, null, 2) + '\n'), branch: 'main' };
    if (SHAS[path]) body.sha = SHAS[path];
    const d = await gh('/repos/' + AUTH.owner + '/' + AUTH.repo + '/contents/' + path, { method: 'PUT', body: JSON.stringify(body) });
    SHAS[path] = d.content.sha;
    status('Enregistré ✓ — en ligne dans ~1 minute (reconstruction du site)');
  };

  const uploadImage = (file, dir) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const b64 = reader.result.split(',')[1];
        const name = dir + '/' + Date.now() + '-' + file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
        await gh('/repos/' + AUTH.owner + '/' + AUTH.repo + '/contents/' + name, {
          method: 'PUT',
          body: JSON.stringify({ message: 'admin : photo ' + name, content: b64, branch: 'main' })
        });
        resolve(name);
      } catch (e) { reject(e); }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  // ---------- Connexion ----------
  // Le jeton GitHub est chiffré (AES-GCM, clé dérivée du mot de passe par PBKDF2)
  // et conservé uniquement dans ce navigateur. Le site publié n'en contient jamais.
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  const ITERATIONS = 600000; // recommandation OWASP 2023 pour PBKDF2-SHA256
  async function derive(pass, salt, it) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: it || 250000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  async function encryptToken(token, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await derive(pass, salt, ITERATIONS);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token));
    return { salt: b64(salt), iv: b64(iv), ct: b64(ct), it: ITERATIONS };
  }

  async function decryptToken(box, pass) {
    const key = await derive(pass, unb64(box.salt), box.it);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
    return dec.decode(pt);
  }

  const VAULT = 'fq_admin_vault';

  const enterApp = async (owner, repo) => {
    $('login-view').classList.add('hidden');
    $('app-view').classList.remove('hidden');
    $('logout').classList.remove('hidden');
    $('backup-history').href = 'https://github.com/' + owner + '/' + repo + '/commits/main';
    await reloadAll();
    status('Connecté ✓');
  };

  const checkToken = async (owner, repo, token) => {
    AUTH = { owner, repo, token };
    const r = await gh('/repos/' + owner + '/' + repo);
    if (!r.permissions || !r.permissions.push) throw new Error('Ce jeton n’a pas les droits d’écriture sur le dépôt.');
  };

  // Première connexion : jeton + création du mot de passe
  $('btn-login').addEventListener('click', async () => {
    $('login-err').textContent = '';
    const owner = $('in-owner').value.trim(), repo = $('in-repo').value.trim();
    const token = $('in-token').value.trim();
    const p1 = $('in-newpass').value, p2 = $('in-newpass2').value;
    if (!token) { $('login-err').textContent = 'Merci de coller votre jeton d’accès.'; return; }
    if (p1.length < 10) { $('login-err').textContent = 'Le mot de passe doit faire au moins 10 caractères.'; return; }
    if (p1 !== p2) { $('login-err').textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
    try {
      await checkToken(owner, repo, token);
      const box = await encryptToken(token, p1);
      const store = $('in-remember').checked ? localStorage : sessionStorage;
      store.setItem(VAULT, JSON.stringify(Object.assign({ owner, repo }, box)));
      await enterApp(owner, repo);
    } catch (e) {
      AUTH = null;
      $('login-err').textContent = 'Connexion impossible : ' + e.message;
    }
  });

  // Connexions suivantes : mot de passe seul
  const unlock = async () => {
    $('quick-err').textContent = '';
    const raw = localStorage.getItem(VAULT) || sessionStorage.getItem(VAULT);
    if (!raw) return;
    const v = JSON.parse(raw);
    try {
      const token = await decryptToken(v, $('in-pass').value);
      await checkToken(v.owner, v.repo, token);
      // Ancien coffre (250 000 itérations) : on le rechiffre au nouveau niveau, même mot de passe
      if (!v.it || v.it < ITERATIONS) {
        const store = localStorage.getItem(VAULT) ? localStorage : sessionStorage;
        store.setItem(VAULT, JSON.stringify(Object.assign({ owner: v.owner, repo: v.repo }, await encryptToken(token, $('in-pass').value))));
      }
      await enterApp(v.owner, v.repo);
    } catch (e) {
      AUTH = null;
      $('quick-err').textContent = (e.name === 'OperationError' || /decrypt|operation-specific/i.test(e.message || ''))
        ? 'Mot de passe incorrect.'
        : 'Connexion impossible : ' + e.message;
    }
  };

  $('btn-unlock').addEventListener('click', unlock);
  $('in-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });

  $('link-reset').addEventListener('click', (e) => {
    e.preventDefault();
    if (!confirm('Oublier l’accès enregistré sur cet appareil ? Il faudra recoller le jeton GitHub.')) return;
    localStorage.removeItem(VAULT); sessionStorage.removeItem(VAULT);
    location.reload();
  });

  $('logout').addEventListener('click', () => {
    // On garde le coffre chiffré : la prochaine fois, le mot de passe suffira.
    AUTH = null;
    location.reload();
  });

  // Au chargement : coffre présent -> mot de passe ; sinon -> écran complet
  (function initLogin() {
    // Migration depuis l'ancien format (jeton en clair)
    const legacy = localStorage.getItem('fq_admin') || sessionStorage.getItem('fq_admin');
    if (legacy && !localStorage.getItem(VAULT) && !sessionStorage.getItem(VAULT)) {
      try {
        const s = JSON.parse(legacy);
        $('in-owner').value = s.owner; $('in-repo').value = s.repo; $('in-token').value = s.token;
        $('login-err').textContent = 'Votre accès a été retrouvé : choisissez un mot de passe pour ne plus avoir à saisir le jeton.';
        $('login-err').style.color = '#4A3A2F';
      } catch (e) { /* ignore */ }
      localStorage.removeItem('fq_admin'); sessionStorage.removeItem('fq_admin');
      return;
    }
    if (localStorage.getItem(VAULT) || sessionStorage.getItem(VAULT)) {
      $('login-full').classList.add('hidden');
      $('login-quick').classList.remove('hidden');
      setTimeout(() => $('in-pass').focus(), 100);
    }
  })();

  // ---------- Textes des pages ----------
  function renderTextes() {
    const page = $('txt-page').value;
    const cles = Object.keys(TEXTES).filter((k) => k.startsWith(page + '.'));
    $('txt-champs').innerHTML = cles.map((k) => {
      const t = TEXTES[k];
      const lab = (t.label || k).replace(/^[^—]*—\s*/, '');
      const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return '<div style="border-top:1px dashed #ddd2c2;padding-top:0.8rem;margin-top:0.8rem;">' +
        '<label style="text-transform:none;letter-spacing:0;font-size:0.85rem;">' + esc(lab) + '</label>' +
        '<div class="grid2">' +
        '<div><label style="font-size:0.7rem;">Fran&ccedil;ais</label><textarea data-tk="' + escA(k) + '" data-tl="fr">' + esc(t.fr) + '</textarea></div>' +
        '<div><label style="font-size:0.7rem;">Anglais</label><textarea data-tk="' + escA(k) + '" data-tl="en">' + esc(t.en) + '</textarea></div>' +
        '</div></div>';
    }).join('') || '<p class="hint">Aucun texte modifiable sur cette rubrique.</p>';
  }

  $('txt-page').addEventListener('change', renderTextes);

  $('save-textes').addEventListener('click', async () => {
    $('txt-champs').querySelectorAll('textarea[data-tk]').forEach((ta) => {
      const k = ta.dataset.tk, l = ta.dataset.tl;
      if (TEXTES[k]) TEXTES[k][l] = ta.value;
    });
    try { await saveFile('data/textes.json', TEXTES, 'textes des pages'); } catch (e) { status(e.message, true); }
  });

  // ---------- Chargement ----------
  async function reloadAll() {
    [SITE, ACTUS, PRODUITS, AVIS, TEXTES] = await Promise.all([
      loadFile('data/site.json'), loadFile('data/actus.json'), loadFile('data/produits.json'), loadFile('data/avis.json'), loadFile('data/textes.json')
    ]);
    fillInfos(); renderActus(); renderProduits(); fillAvisMeta(); renderAvis(); renderTextes();
  }

  // ---------- Onglets ----------
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.add('hidden'));
    $('pane-' + t.dataset.tab).classList.remove('hidden');
  }));

  // ---------- Infos ----------
  function fillInfos() {
    $('s-telephone').value = SITE.contact.telephone;
    $('s-tel_href').value = SITE.contact.tel_href;
    $('s-email').value = SITE.contact.email;
    $('s-cafe_fr').value = SITE.horaires.cafe_fr;
    $('s-cafe_en').value = SITE.horaires.cafe_en;
    $('s-restaurant_fr').value = SITE.horaires.restaurant_fr;
    $('s-restaurant_en').value = SITE.horaires.restaurant_en;
    $('s-cafe_de').value = SITE.horaires.cafe_de || '';
    $('s-cafe_nl').value = SITE.horaires.cafe_nl || '';
    $('s-cafe_it').value = SITE.horaires.cafe_it || '';
    $('s-reservation').value = SITE.liens.reservation;
    $('s-bons_cadeaux').value = SITE.liens.bons_cadeaux;
    $('s-instagram_cafe').value = SITE.liens.instagram_cafe || '';
    $('s-instagram').value = SITE.liens.instagram;
    $('s-facebook').value = SITE.liens.facebook;
    const R = SITE.rubriques || {};
    $('s-rub-boutique').checked = R.boutique !== false;
    $('s-rub-ateliers').checked = R.ateliers !== false;
    $('s-rub-msg-fr').value = R.message_fr || 'Ouverture prochainement — courant septembre';
    $('s-rub-msg-en').value = R.message_en || 'Opening soon — this September';
  }

  $('save-infos').addEventListener('click', async () => {
    // On complète l'existant au lieu de le remplacer : les champs absents du formulaire
    // (horaires et messages en allemand, néerlandais, italien, cafe_court…) sont conservés.
    const prev = SITE || {};
    SITE = Object.assign({}, prev, {
      contact: Object.assign({}, prev.contact, { telephone: $('s-telephone').value, tel_href: $('s-tel_href').value, email: $('s-email').value }),
      horaires: Object.assign({}, prev.horaires, { cafe_fr: $('s-cafe_fr').value, cafe_en: $('s-cafe_en').value, restaurant_fr: $('s-restaurant_fr').value, restaurant_en: $('s-restaurant_en').value,
                  cafe_de: $('s-cafe_de').value, cafe_nl: $('s-cafe_nl').value, cafe_it: $('s-cafe_it').value }),
      liens: Object.assign({}, prev.liens, { reservation: $('s-reservation').value, bons_cadeaux: $('s-bons_cadeaux').value, instagram_cafe: $('s-instagram_cafe').value, instagram: $('s-instagram').value, facebook: $('s-facebook').value }),
      rubriques: Object.assign({}, prev.rubriques, { boutique: $('s-rub-boutique').checked, ateliers: $('s-rub-ateliers').checked, message_fr: $('s-rub-msg-fr').value, message_en: $('s-rub-msg-en').value })
    });
    try { await saveFile('data/site.json', SITE, 'infos pratiques'); } catch (e) { status(e.message, true); }
  });

  // ---------- Actus ----------
  function renderActus() {
    ACTUS.sort((a, b) => b.date.localeCompare(a.date));
    $('actus-liste').innerHTML = ACTUS.map((a, i) =>
      '<div class="item"><div><strong>' + escA(a.titre) + '</strong><small>' + escA(a.date) + '</small></div>' +
      '<div class="item-actions"><button data-edit="' + i + '">Modifier</button><button class="del" data-del="' + i + '">Suppr.</button></div></div>'
    ).join('') || '<p class="hint">Aucune actu pour le moment.</p>';
  }

  $('actus-liste').addEventListener('click', async (e) => {
    const ed = e.target.dataset.edit, del = e.target.dataset.del;
    if (ed != null) {
      editActu = +ed;
      const a = ACTUS[editActu];
      $('a-date').value = a.date; $('a-titre').value = a.titre; $('a-titre_en').value = a.titre_en || '';
      $('a-texte').value = a.texte; $('a-texte_en').value = a.texte_en || '';
      $('a-lien').value = a.lien || ''; $('a-lien_texte').value = a.lien_texte || ''; $('a-image').value = a.image || '';
      $('actu-form').classList.remove('hidden');
    }
    if (del != null && confirm('Supprimer cette actu ?')) {
      ACTUS.splice(+del, 1);
      try { await saveFile('data/actus.json', ACTUS, 'suppression actu'); renderActus(); } catch (err) { status(err.message, true); }
    }
  });

  $('actu-new').addEventListener('click', () => {
    editActu = null;
    ['a-titre', 'a-titre_en', 'a-texte', 'a-texte_en', 'a-lien', 'a-lien_texte', 'a-image'].forEach((id) => { $(id).value = ''; });
    $('a-date').value = new Date().toISOString().slice(0, 10);
    $('a-image-file').value = '';
    $('actu-form').classList.remove('hidden');
  });

  $('actu-cancel').addEventListener('click', () => $('actu-form').classList.add('hidden'));

  $('actu-save').addEventListener('click', async () => {
    try {
      const f = $('a-image-file').files[0];
      if (f) { status('Envoi de la photo…'); $('a-image').value = await uploadImage(f, 'img/actus'); }
      const a = {
        id: editActu != null ? ACTUS[editActu].id : 'actu-' + Date.now(),
        date: $('a-date').value, titre: $('a-titre').value, titre_en: $('a-titre_en').value || null,
        texte: $('a-texte').value, texte_en: $('a-texte_en').value || null,
        image: $('a-image').value || null, lien: $('a-lien').value || null, lien_texte: $('a-lien_texte').value || null
      };
      if (!a.date || !a.titre) return status('Date et titre obligatoires.', true);
      if (editActu != null) ACTUS[editActu] = a; else ACTUS.push(a);
      await saveFile('data/actus.json', ACTUS, (editActu != null ? 'modification' : 'ajout') + ' actu « ' + a.titre + ' »');
      $('actu-form').classList.add('hidden');
      renderActus();
    } catch (e) { status(e.message, true); }
  });

  // ---------- Produits ----------
  const CATS = { vins: 'Les vins', ceramique: 'Les céramiques', huile: "L'huile d'olive", cafe: 'Le café', cadeau: 'Bons cadeaux' };

  function renderProduits() {
    $('produits-liste').innerHTML = PRODUITS.map((p, i) =>
      '<div class="item"><div><strong>' + escA(p.nom) + '</strong><small>' + escA(CATS[p.categorie] || p.categorie) + ' · ' +
      (p.prix != null ? p.prix.toFixed(2).replace('.', ',') + ' €' : 'prix à venir') + ' · ' +
      (p.stripe ? 'paiement OK' : 'pas de paiement') + (p.dispo === false ? ' · masqué' : '') + '</small></div>' +
      '<div class="item-actions"><button data-edit="' + i + '">Modifier</button><button class="del" data-del="' + i + '">Suppr.</button></div></div>'
    ).join('') || '<p class="hint">Aucun produit pour le moment.</p>';
  }

  $('produits-liste').addEventListener('click', async (e) => {
    const ed = e.target.dataset.edit, del = e.target.dataset.del;
    if (ed != null) {
      editProd = +ed;
      const p = PRODUITS[editProd];
      $('p-nom').value = p.nom; $('p-nom_en').value = p.nom_en || '';
      $('p-categorie').value = p.categorie; $('p-prix').value = p.prix != null ? p.prix : '';
      $('p-description').value = p.description; $('p-description_en').value = p.description_en || '';
      $('p-stripe').value = p.stripe || ''; $('p-image').value = p.image || '';
      $('p-dispo').checked = p.dispo !== false;
      $('prod-form').classList.remove('hidden');
    }
    if (del != null && confirm('Supprimer ce produit ?')) {
      PRODUITS.splice(+del, 1);
      try { await saveFile('data/produits.json', PRODUITS, 'suppression produit'); renderProduits(); } catch (err) { status(err.message, true); }
    }
  });

  $('prod-new').addEventListener('click', () => {
    editProd = null;
    ['p-nom', 'p-nom_en', 'p-prix', 'p-description', 'p-description_en', 'p-stripe', 'p-image'].forEach((id) => { $(id).value = ''; });
    $('p-categorie').value = 'vins'; $('p-dispo').checked = true; $('p-image-file').value = '';
    $('prod-form').classList.remove('hidden');
  });

  $('prod-cancel').addEventListener('click', () => $('prod-form').classList.add('hidden'));

  $('prod-save').addEventListener('click', async () => {
    try {
      const f = $('p-image-file').files[0];
      if (f) { status('Envoi de la photo…'); $('p-image').value = await uploadImage(f, 'img/produits'); }
      const slug = $('p-nom').value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      const p = {
        id: editProd != null ? PRODUITS[editProd].id : ($('p-categorie').value + '-' + slug),
        categorie: $('p-categorie').value,
        nom: $('p-nom').value, nom_en: $('p-nom_en').value || null,
        description: $('p-description').value, description_en: $('p-description_en').value || null,
        prix: $('p-prix').value === '' ? null : parseFloat($('p-prix').value),
        image: $('p-image').value || null,
        stripe: $('p-stripe').value || null,
        dispo: $('p-dispo').checked
      };
      if (!p.nom) return status('Le nom est obligatoire.', true);
      if (editProd != null) PRODUITS[editProd] = p; else PRODUITS.push(p);
      await saveFile('data/produits.json', PRODUITS, (editProd != null ? 'modification' : 'ajout') + ' produit « ' + p.nom + ' »');
      $('prod-form').classList.add('hidden');
      renderProduits();
    } catch (e) { status(e.message, true); }
  });

  // ---------- Avis (lecture seule : mis à jour chaque heure depuis Uniiti) ----------
  // Textes écrits par des clients sur une page tierce : toujours échappés avant affichage.

  function fillAvisMeta() {
    const maj = AVIS.mis_a_jour ? new Date(AVIS.mis_a_jour).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) : '—';
    $('avis-resume').innerHTML = '<p><strong>' + escA(AVIS.note_moyenne) + '/5</strong> &middot; ' + escA(AVIS.nombre_avis) +
      ' avis &middot; dernière mise à jour&nbsp;: ' + escA(maj) +
      (AVIS.source_url ? ' &middot; <a href="' + escA(AVIS.source_url) + '" target="_blank" rel="noopener">voir sur Uniiti</a>' : '') + '</p>';
  }

  function renderAvis() {
    $('avis-liste').innerHTML = (AVIS.avis || []).map((a) =>
      '<div class="item"><div><strong>' + '★'.repeat(Math.max(0, Math.min(5, Number(a.note) || 0))) + '</strong><small>' + escA(a.auteur) + ' — ' +
      escA(a.texte.slice(0, 80)) + (a.texte.length > 80 ? '…' : '') + '</small></div></div>'
    ).join('') || '<p class="hint">Aucun avis pour le moment.</p>';
  }

  // ---------- Backup ----------
  $('backup-dl').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ exporte_le: new Date().toISOString(), site: SITE, actus: ACTUS, produits: PRODUITS, avis: AVIS }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'franquette-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
  });

  $('backup-restore').addEventListener('click', async () => {
    const f = $('backup-restore-file').files[0];
    if (!f) return status('Choisissez d’abord un fichier de sauvegarde.', true);
    if (!confirm('Restaurer cette sauvegarde et remplacer le contenu actuel ?')) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data.site || !data.actus || !data.produits) throw new Error('Fichier de sauvegarde invalide.');
      SITE = data.site; ACTUS = data.actus; PRODUITS = data.produits;
      if (data.avis) AVIS = data.avis;
      await saveFile('data/site.json', SITE, 'restauration sauvegarde (infos)');
      await saveFile('data/actus.json', ACTUS, 'restauration sauvegarde (actus)');
      await saveFile('data/produits.json', PRODUITS, 'restauration sauvegarde (produits)');
      if (data.avis) await saveFile('data/avis.json', AVIS, 'restauration sauvegarde (avis)');
      fillInfos(); renderActus(); renderProduits(); fillAvisMeta(); renderAvis(); renderTextes();
      status('Sauvegarde restaurée ✓');
    } catch (e) { status(e.message, true); }
  });
})();
