#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Met à jour data/avis.json à partir de la page d'avis Uniiti du restaurant.

Lancé toutes les heures par .github/workflows/avis.yml.
Bibliothèque standard uniquement : aucune dépendance à installer.

Garde-fous : si la page ne répond pas ou si son format a changé (note absente,
aucun avis lisible…), le script s'arrête en erreur SANS toucher au fichier.
Le site garde alors les derniers avis valides au lieu d'afficher du vide.

Usage :  python3 scripts/avis_uniiti.py [fichier_html_de_test]
"""
import html
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SOURCE_URL = "https://restaurantfranquette.fr/fr/opinions"
SORTIE = Path(__file__).resolve().parent.parent / "data" / "avis.json"
NB_AVIS_AFFICHES = 6


def lire_page(chemin=None):
    if chemin:
        return Path(chemin).read_text(encoding="utf-8", errors="ignore")
    req = urllib.request.Request(SOURCE_URL, headers={
        "User-Agent": "Mozilla/5.0 (site Franquette ; mise a jour des avis)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="ignore")


def texte(fragment):
    t = html.unescape(re.sub(r"<[^>]+>", " ", fragment))
    return re.sub(r"\s+", " ", t).strip()


def nom_court(nom):
    """« Anne Belloteau » -> « Anne B. » ; gère « Mary Loftus & Denis O'Brien »."""
    parts = []
    for p in re.split(r"\s*&\s*", nom):
        mots = p.split()
        if not mots:
            continue
        parts.append(mots[0].capitalize() + (f" {mots[-1][0].upper()}." if len(mots) > 1 else ""))
    return " & ".join(parts)


def extraire(page):
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

    avis = []
    for bloc in page.split('class="review-note"')[1:]:
        m_nom = re.search(r"<p>\s*(.*?)\s+a not[ée]\s*</p>", bloc, re.S)
        m_note = re.search(r"<span>\s*(\d)\s*/\s*5\s*</span>", bloc)
        m_txt = re.search(r'class="note[^"]*">\s*<p>(.*?)</p>', bloc, re.S)
        m_date = re.search(r"(\d{2})/(\d{2})/(\d{4})", bloc)
        if not (m_nom and m_note):
            continue
        corps = texte(m_txt.group(1)) if m_txt else ""
        if len(re.sub(r"[\W_]", "", corps)) < 3:      # avis sans commentaire (« . »)
            continue
        avis.append({
            "note": int(m_note.group(1)),
            "texte": corps,
            "auteur": nom_court(texte(m_nom.group(1))),
            "date": f"{m_date.group(3)}-{m_date.group(2)}-{m_date.group(1)}" if m_date else None,
        })
    if not avis:
        raise ValueError("aucun avis avec commentaire n'a pu être lu")

    return {
        "source": "Uniiti",
        "source_url": SOURCE_URL,
        "note_moyenne": moyenne,
        "nombre_avis": nombre,
        "mis_a_jour": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "avis": avis[:NB_AVIS_AFFICHES],
    }


def main():
    try:
        data = extraire(lire_page(sys.argv[1] if len(sys.argv) > 1 else None))
    except Exception as e:                            # noqa: BLE001 — on veut tout attraper
        print(f"ÉCHEC, avis.json inchangé : {e}", file=sys.stderr)
        sys.exit(1)

    ancien = json.loads(SORTIE.read_text(encoding="utf-8")) if SORTIE.exists() else {}
    comparer = lambda d: {k: v for k, v in d.items() if k != "mis_a_jour"}
    if comparer(ancien) == comparer(data):
        print(f"Aucun changement ({data['note_moyenne']}/5, {data['nombre_avis']} avis).")
        return
    SORTIE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"avis.json mis à jour : {data['note_moyenne']}/5, {data['nombre_avis']} avis, "
          f"{len(data['avis'])} avis affichés.")


if __name__ == "__main__":
    main()
