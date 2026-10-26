#!/usr/bin/env python3
"""Régénère data/formations.json à partir de l'open data Parcoursup.

Source : https://data.enseignementsup-recherche.gouv.fr (jeux fr-esr-parcoursup et
fr-esr-parcoursup_<année>), Licence Ouverte. Aucune dépendance hors bibliothèque standard.

Exemples :
    python3 scripts/update_data.py                       # toute la France métropolitaine
    python3 scripts/update_data.py --ville-centre 48.111,-1.68 --rayon 400   # zone réduite
"""
import argparse
import datetime as dt
import json
import math
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets/"
CURRENT = "fr-esr-parcoursup"
CPGE = ["MPSI", "PCSI", "PTSI", "MP2I", "BCPST", "TSI", "TB", "TPC"]
WHERE_CPGE = 'fili="CPGE" and fil_lib_voe_acc in (' + ",".join(f'"{x}"' for x in CPGE) + ")"
WHERE_ING = 'fili="Ecole d\'Ingénieur" and fil_lib_voe_acc="Formation d\'ingénieur Bac + 5"'
# Voies d'accès qui ne concernent pas un élève de terminale générale
EXCLURE = re.compile(r"STI2D|STL|echnolog|BAC \+1|Autres S[ée]ries|STAV|ST2S|r[ée]serv[ée]e aux candidates", re.I)
FIELDS = ["id", "etab", "ville", "dep", "lat", "lon", "filiere", "detail", "public", "capa", "voeux", "taux",
          "rangDernier", "classes", "pTBF", "pTB", "pB", "pAB", "pSans", "pBours", "pF", "internat",
          "pAcaOrig", "admis", "tauxPrev"]


def export(dataset, where):
    url = API + dataset + "/exports/json?where=" + urllib.parse.quote(where)
    req = urllib.request.Request(url, headers={"User-Agent": "cap-prepa/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def dist(a, b, c, d):
    t = math.pi / 180
    x = math.sin((c - a) * t / 2) ** 2 + math.cos(a * t) * math.cos(c * t) * math.sin((d - b) * t / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(x))


def clean(s):
    return re.sub(r"\s+", " ", s or "").strip()


def build_rows(cur, prev, metropole=True, centre=None, rayon=None):
    prev_rate = {str(r.get("cod_aff_form")): r.get("taux_acces_ens") for r in prev}
    rows, seen = [], set()
    for r in cur:
        ing = r.get("fili") != "CPGE"
        if ing:
            det = " · ".join(x for x in (clean(r.get("detail_forma2")), clean(r.get("detail_forma"))) if x)
            if EXCLURE.search(det):
                continue
        else:
            det = clean(r.get("detail_forma"))
        g = r.get("g_olocalisation_des_formations") or {}
        lat, lon = g.get("lat"), g.get("lon")
        if lat is None or lon is None:
            continue
        if metropole and not (41 <= lat <= 51.5 and -5.5 <= lon <= 10):
            continue
        if centre and rayon and dist(centre[0], centre[1], lat, lon) > rayon:
            continue
        key = (r.get("g_ea_lib_vx"), det, r.get("capa_fin"), r.get("voe_tot"))
        if key in seen:  # concours communs : même ligne répétée pour chaque site
            continue
        seen.add(key)
        pv = prev_rate.get(str(r.get("cod_aff_form")))
        rows.append([
            int(r["cod_aff_form"]), clean(r.get("g_ea_lib_vx")), clean(r.get("ville_etab")), r.get("dep"),
            round(lat, 3), round(lon, 3), "ING" if ing else r.get("fil_lib_voe_acc"), det[:80],
            1 if r.get("contrat_etab") == "Public" else 0, r.get("capa_fin"), r.get("voe_tot"),
            r.get("taux_acces_ens"), r.get("ran_grp1"), r.get("nb_cla_pp"),
            r.get("pct_tbf"), r.get("pct_tb"), r.get("pct_b"), r.get("pct_ab"), r.get("pct_sansmention"),
            r.get("pct_bours"), r.get("pct_f"), 1 if (r.get("nb_voe_pp_internat") or 0) > 0 else 0,
            r.get("pct_aca_orig"), r.get("acc_tot"), None if pv is None else int(pv),
        ])
    rows.sort(key=lambda x: x[0])
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sortie", default=str(Path(__file__).resolve().parent.parent / "data" / "formations.json"))
    ap.add_argument("--ville-centre", help="lat,lon : ne garder qu'une zone autour de ce point")
    ap.add_argument("--rayon", type=float, help="rayon en km autour de --ville-centre")
    ap.add_argument("--avec-outre-mer", action="store_true", help="inclure les DROM et l'étranger")
    a = ap.parse_args()

    centre = tuple(float(x) for x in a.ville_centre.split(",")) if a.ville_centre else None
    print("Téléchargement de la session courante…", file=sys.stderr)
    cur = export(CURRENT, WHERE_CPGE) + export(CURRENT, WHERE_ING)
    if not cur:
        sys.exit("Aucune donnée reçue.")
    session = int(cur[0].get("session"))
    prev = []
    try:
        prev = export(f"{CURRENT}_{session - 1}", WHERE_CPGE) + export(f"{CURRENT}_{session - 1}", WHERE_ING)
    except Exception as e:  # le jeu de l'année précédente peut manquer : la tendance sera vide
        print(f"Session {session - 1} indisponible ({e}), pas de tendance.", file=sys.stderr)

    rows = build_rows(cur, prev, metropole=not a.avec_outre_mer, centre=centre, rayon=a.rayon)
    if centre and a.rayon:
        coverage = {"label": f"{int(a.rayon)} km autour de {centre[0]},{centre[1]}", "center": list(centre), "radiusKm": a.rayon}
    else:
        coverage = None
    meta = {"session": session, "previousSession": session - 1,
            "source": "https://data.enseignementsup-recherche.gouv.fr/explore/dataset/fr-esr-parcoursup/",
            "licence": "Licence Ouverte / Open Licence (Etalab)",
            "generated": dt.date.today().isoformat(), "fields": FIELDS}
    if coverage:
        meta["coverage"] = coverage
    out = json.dumps({"meta": meta, "rows": rows}, ensure_ascii=False, separators=(",", ":")).replace("],[", "],\n[")
    Path(a.sortie).write_text(out + "\n", encoding="utf-8")
    print(f"{len(rows)} formations écrites dans {a.sortie} (session {session}).", file=sys.stderr)


if __name__ == "__main__":
    main()
