#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Met à jour data/avis.json à partir des avis Uniiti du restaurant.

Lancé toutes les heures par .github/workflows/avis.yml.
Bibliothèque standard uniquement : aucune dépendance à installer.

- Note globale et nombre d'avis : page d'avis du site du restaurant.
- Commentaires : l'adresse publique qu'utilise le bouton « Afficher plus d'avis »
  de la fiche Uniiti, lue page par page (10 avis par page) jusqu'à en avoir 15.
  Si elle ne répond pas, repli sur les 10 avis de la page du restaurant.

Garde-fous : si la page ne répond pas ou si son format a changé (note absente,
aucun avis lisible…), le script s'arrête en erreur SANS toucher au fichier.
Le site garde alors les derniers avis valides au lieu d'afficher du vide.

Usage :  python3 scripts/avis_uniiti.py [fichier_html_de_test]
"""
import html
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

PAGE_AVIS = "https://restaurantfranquette.fr/fr/opinions"
API_AVIS = "https://uniiti.com/api/opinion-request/shop/load-more-ureview-reviews"
SHOP_ID = 764                      # identifiant Uniiti de Franquette (fiche uniiti.com/shop/franquette)
SORTIE = Path(__file__).resolve().parent.parent / "data" / "avis.json"
NB_AVIS_AFFICHES = 15
PAGES_MAX = 6                      # au plus 60 avis parcourus pour trouver 15 commentaires
UA = "Mozilla/5.0 (site Franquette ; mise a jour des avis)"


def lire_page(chemin=None):
    if chemin:
        return Path(chemin).read_text(encoding="utf-8", errors="ignore")
    req = urllib.request.Request(PAGE_AVIS, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="ignore")


def lire_api(page):
    req = urllib.request.Request(
        API_AVIS, data=urllib.parse.urlencode({"shopId": SHOP_ID, "page": page}).encode(),
        headers={"User-Agent": UA, "X-Requested-With": "XMLHttpRequest",
                 "Accept": "application/json, text/javascript, */*; q=0.01",   # sans lui : 406
                 "Referer": "https://uniiti.com/shop/franquette"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", errors="ignore"))


def texte(fragment):
    t = html.unescape(re.sub(r"<[^>]+>", " ", fragment))
    return re.sub(r"\s+", " ", t).strip()


def nom_court(nom):
    """« Anne Belloteau » -> « Anne B. » ; gère « Mary Loftus & Denis O'Brien »."""
    parts = []
    for p in re.split(r"\s*&\s*", nom):
        mots = p.split()
        if not re.search(r"[^\W\d_]", p):             # morceau sans lettre (« . ») : ignoré
            continue
        parts.append(mots[0].capitalize() + (f" {mots[-1][0].upper()}." if len(mots) > 1 else ""))
    return " & ".join(parts)


def avis_ok(nom, note, corps, date):
    """Construit un avis, ou None s'il n'a pas de vrai commentaire (« . »)."""
    if len(re.sub(r"[\W_]", "", corps)) < 3:
        return None
    return {"note": note, "texte": corps, "auteur": nom_court(nom),
            "date": f"{date.group(3)}-{date.group(2)}-{date.group(1)}" if date else None}


def note_globale(page):
    i = page.find("avis sur Uniiti")
    if i < 0:
        raise ValueError("bloc « avis sur Uniiti » introuvable")
    total = re.search(r"(\d[\d\s .]*)\s*avis sur Uniiti", page[max(0, i - 60):i + 20])
    note = re.search(r"(\d[.,]\d)\s*/\s*5", page[i:i + 4000])
    if not total or not note:
        raise ValueError("note globale ou nombre d'avis illisible")
    nombre = int(re.sub(r"\D", "", total.group(1)))
    moyenne = float(note.group(1).replace(",", "."))
    if not (1 <= moyenne <= 5) or nombre <= 0:
        raise ValueError(f"valeurs incohérentes : {moyenne}/5, {nombre} avis")
    return moyenne, nombre


def avis_page_restaurant(page):
    """Les 10 avis affichés sur restaurantfranquette.fr (repli)."""
    avis = []
    for bloc in page.split('class="review-note"')[1:]:
        m_nom = re.search(r"<p>\s*(.*?)\s+a not[ée]\s*</p>", bloc, re.S)
        m_note = re.search(r"<span>\s*(\d)\s*/\s*5\s*</span>", bloc)
        m_txt = re.search(r'class="note[^"]*">\s*<p>(.*?)</p>', bloc, re.S)
        if m_nom and m_note:
            a = avis_ok(texte(m_nom.group(1)), int(m_note.group(1)),
                        texte(m_txt.group(1)) if m_txt else "", re.search(r"(\d{2})/(\d{2})/(\d{4})", bloc))
            if a:
                avis.append(a)
    return avis


def avis_fragment_uniiti(fragment):
    """Avis contenus dans un morceau de HTML renvoyé par l'API Uniiti."""
    avis = []
    for bloc in re.split(r'class="[^"]*\bopinion\b[^"]*"', fragment)[1:]:
        m_nom = re.search(r'class="author">\s*<span>(.*?)</span>', bloc, re.S)
        m_note = re.search(r"(\d)\s*/\s*5", bloc)
        m_txt = re.search(r'class="text">(.*?)</p>', bloc, re.S)
        if m_nom and m_note:
            a = avis_ok(texte(m_nom.group(1)), int(m_note.group(1)),
                        texte(m_txt.group(1)) if m_txt else "", re.search(r"(\d{2})/(\d{2})/(\d{4})", bloc))
            if a:
                avis.append(a)
    return avis


def avis_recents():
    avis, vus = [], set()
    for p in range(1, PAGES_MAX + 1):
        d = lire_api(p)
        if d.get("status") != "success":
            raise ValueError(f"page {p} : statut « {d.get('status')} »")
        for a in avis_fragment_uniiti(d.get("html", "")):
            cle = (a["auteur"], a["date"], a["texte"][:40])
            if cle not in vus:
                vus.add(cle)
                avis.append(a)
        if len(avis) >= NB_AVIS_AFFICHES or not d.get("hasMore"):
            break
    if len(avis) < 3:
        raise ValueError(f"seulement {len(avis)} avis lisibles")
    return avis


def main():
    test = sys.argv[1] if len(sys.argv) > 1 else None
    try:
        page = lire_page(test)
        moyenne, nombre = note_globale(page)
        try:
            avis = avis_page_restaurant(page) if test else avis_recents()
        except Exception as e:                        # noqa: BLE001
            print(f"API Uniiti indisponible ({e}) : repli sur les avis de la page du restaurant.",
                  file=sys.stderr)
            avis = avis_page_restaurant(page)
        if not avis:
            raise ValueError("aucun avis avec commentaire n'a pu être lu")
    except Exception as e:                            # noqa: BLE001 — on veut tout attraper
        print(f"ÉCHEC, avis.json inchangé : {e}", file=sys.stderr)
        sys.exit(1)

    data = {"source": "Uniiti", "source_url": PAGE_AVIS, "note_moyenne": moyenne,
            "nombre_avis": nombre,
            "mis_a_jour": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "avis": avis[:NB_AVIS_AFFICHES]}
    ancien = json.loads(SORTIE.read_text(encoding="utf-8")) if SORTIE.exists() else {}
    comparer = lambda d: {k: v for k, v in d.items() if k != "mis_a_jour"}
    if comparer(ancien) == comparer(data):
        print(f"Aucun changement ({moyenne}/5, {nombre} avis).")
        return
    SORTIE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"avis.json mis à jour : {moyenne}/5, {nombre} avis, {len(data['avis'])} avis affichés.")


if __name__ == "__main__":
    main()
