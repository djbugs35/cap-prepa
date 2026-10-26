"""Regenerer data/formations.json a partir de l'open data Parcoursup.

Sources (Licence Ouverte, data.enseignementsup-recherche.gouv.fr) :
- fr-esr-parcoursup et fr-esr-parcoursup_<annee> : statistiques par formation, session courante et historique ;
- fr-esr-cartographie_formations_parcoursup : internat des CPGE ;
- fr-esr-parcoursup-enseignements-de-specialite-bacheliers-generaux-3 : propositions par doublette de specialites.

Aucune dependance hors bibliotheque standard.

Exemples :
    python3 scripts/update_data.py                                         # toute la France metropolitaine
    python3 scripts/update_data.py --ville-centre 48.111,-1.68 --rayon 400  # une zone seulement
"""

import argparse
import datetime as dt
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets/"
JEU_COURANT = "fr-esr-parcoursup"
JEU_CARTOGRAPHIE = "fr-esr-cartographie_formations_parcoursup"
# Le suffixe -3 est l'edition « bac 2025 » ; le filtre sur annee_du_bac ecarte une edition d'une autre session.
JEU_DOUBLETTES = "fr-esr-parcoursup-enseignements-de-specialite-bacheliers-generaux-3"
SORTIE_PAR_DEFAUT = Path(__file__).resolve().parent.parent / "data" / "formations.json"

# Public vise : terminale generale maths + physique-chimie. TSI, TB, TPC (bacs technologiques) sont hors perimetre.
FILIERES_CPGE = ["MPSI", "MP2I", "PCSI", "PTSI", "BCPST"]
FILTRE_CPGE = 'fili="CPGE" and fil_lib_voe_acc in (' + ",".join(f'"{x}"' for x in FILIERES_CPGE) + ")"
FILTRE_ING = 'fili="Ecole d\'Ingénieur" and fil_lib_voe_acc="Formation d\'ingénieur Bac + 5"'
FORMATION_ING_DOUBLETTES = "Formation d'ingénieur Bac + 5"
DOUBLETTE_MATHS_PC = {"Mathématiques Spécialité", "Physique-Chimie Spécialité"}
# Voies d'acces des ecoles qui ne concernent pas un eleve de terminale generale
EXCLURE = re.compile(
    r"STI2D|STL|echnolog|BAC \+1|Autres S[ée]ries|STAV|ST2S|r[ée]serv[ée]e aux candidates", re.IGNORECASE
)
NB_SESSIONS_HISTORIQUE = 2
# En dessous, le telechargement est presque surement tronque : on refuse d'ecraser le fichier.
MIN_LIGNES_NATIONAL = 600
MIN_LIGNES_ZONE = 20
ESSAIS_RESEAU = 4

FIELDS = [
    "id", "etab", "ville", "dep", "lat", "lon", "filiere", "detail", "public", "capa", "voeux",
    "taux", "tauxGen", "rangDernier", "classes", "pTBF", "pTB", "pB", "pAB", "pSans", "pBours", "pF",
    "internat", "pAcaOrig", "admis", "tauxHist", "tauxGenHist", "lien",
]  # fmt: skip
CHAMPS_OBLIGATOIRES = ["id", "etab", "lat", "lon", "filiere", "taux", "admis"]
INTERNAT_SANS, INTERNAT_MIXTE, INTERNAT_FILLES = 0, 1, 2


def telecharger_json(url: str, essais: int = ESSAIS_RESEAU):
    """Rendre le JSON d'une URL, avec reprises exponentielles sur 429, 5xx et coupure reseau.

    Raises:
        urllib.error.HTTPError: erreur HTTP definitive (404 d'un jeu absent, par exemple).
        urllib.error.URLError: reseau toujours indisponible apres les reprises.
    """
    requete = urllib.request.Request(url, headers={"User-Agent": "cap-prepa/1.1"})
    for essai in range(essais):
        try:
            with urllib.request.urlopen(requete, timeout=120) as reponse:
                return json.load(reponse)
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or essai == essais - 1:
                raise
        except urllib.error.URLError:
            if essai == essais - 1:
                raise
        time.sleep(2**essai)
    raise AssertionError("inatteignable")


def exporter(jeu: str, filtre: str, champs: str | None = None) -> list:
    """Rendre toutes les lignes d'un jeu de donnees qui passent le filtre ODSQL."""
    parametres = {"where": filtre}
    if champs:
        parametres["select"] = champs
    return telecharger_json(API + jeu + "/exports/json?" + urllib.parse.urlencode(parametres))


def nom_jeu_session(session: int, session_courante: int) -> str:
    """Rendre le jeu Parcoursup d'une session : le jeu courant n'a pas de suffixe d'annee."""
    return JEU_COURANT if session == session_courante else f"{JEU_COURANT}_{session}"


def dist(a, b, c, d):
    """Rendre la distance en km entre deux points (lat, lon) par la formule de haversine."""
    t = math.pi / 180
    x = math.sin((c - a) * t / 2) ** 2 + math.cos(a * t) * math.cos(c * t) * math.sin((d - b) * t / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(x))


def clean(s):
    """Rendre une chaine aux espaces normalises."""
    return re.sub(r"\s+", " ", s or "").strip()


def taux_officiel(r: dict) -> int | None:
    """Rendre le taux d'acces publie en entier : selon la session, l'open data le livre en texte ("19") ou en reel."""
    try:
        return round(float(r.get("taux_acces_ens")))
    except (TypeError, ValueError):
        return None


def taux_acces_generaux(r: dict) -> int | None:
    """Estimer le taux d'acces des seuls eleves de terminale generale.

    Le taux officiel compte tous les candidats, reorientations et reprises d'etudes comprises : en MPSI,
    pres de la moitie des candidats ne sont pas en terminale generale et le taux affiche sous-estime
    d'un facteur 1,5 a 2 les chances du public vise. On corrige le taux officiel du rapport entre la
    part de propositions recue par les terminales generales et celle de l'ensemble des candidats.

    Returns:
        Le taux estime en %, ou None si une donnee manque.
    """
    taux, prop_tg, cand_tg = taux_officiel(r), r.get("prop_tot_bg"), r.get("nb_voe_pp_bg")
    prop, cand = r.get("prop_tot"), r.get("nb_voe_pp")
    if taux is None or not (prop_tg and cand_tg and prop and cand):
        return None
    return max(0, min(100, round(taux * (prop_tg / cand_tg) / (prop / cand))))


def detail_formation(r: dict) -> str:
    """Rendre le libelle detaille : concours commun et voie d'acces pour une ecole, specialite pour une CPGE."""
    if r.get("fili") == "CPGE":
        return clean(r.get("detail_forma"))
    return " · ".join(x for x in (clean(r.get("detail_forma2")), clean(r.get("detail_forma"))) if x)


def code_internat(r: dict, internats: dict) -> int | None:
    """Rendre le code internat : 0 sans, 1 mixte, 2 filles seulement, None inconnu.

    La cartographie ne renseigne pas l'internat des ecoles d'ingenieurs : sans elle, on ne sait pas.
    """
    libelle = internats.get(str(r.get("cod_aff_form")))
    if libelle:
        return INTERNAT_FILLES if "filles" in libelle and "garçons" not in libelle else INTERNAT_MIXTE
    if r.get("fili") != "CPGE":
        return None
    return INTERNAT_MIXTE if (r.get("nb_cla_pp_internat") or 0) > 0 else INTERNAT_SANS


def construire_ligne(r: dict, historique: list[dict], internats: dict) -> list:
    """Rendre la ligne compacte d'une formation, dans l'ordre de FIELDS."""
    cle = str(r.get("cod_aff_form"))
    passees = [h.get(cle) for h in historique]
    valeurs = {
        "id": int(r["cod_aff_form"]), "etab": clean(r.get("g_ea_lib_vx")), "ville": clean(r.get("ville_etab")),
        "dep": r.get("dep"), "lat": round(r["g_olocalisation_des_formations"]["lat"], 3),
        "lon": round(r["g_olocalisation_des_formations"]["lon"], 3),
        "filiere": r.get("fil_lib_voe_acc") if r.get("fili") == "CPGE" else "ING", "detail": detail_formation(r)[:80],
        "public": 1 if r.get("contrat_etab") == "Public" else 0, "capa": r.get("capa_fin"), "voeux": r.get("voe_tot"),
        "taux": taux_officiel(r), "tauxGen": taux_acces_generaux(r), "rangDernier": r.get("ran_grp1"),
        "classes": r.get("nb_cla_pp"), "pTBF": r.get("pct_tbf"), "pTB": r.get("pct_tb"), "pB": r.get("pct_b"),
        "pAB": r.get("pct_ab"), "pSans": r.get("pct_sansmention"), "pBours": r.get("pct_bours"), "pF": r.get("pct_f"),
        "internat": code_internat(r, internats), "pAcaOrig": r.get("pct_aca_orig"), "admis": r.get("acc_tot"),
        "tauxHist": [p and taux_officiel(p) for p in passees],
        "tauxGenHist": [p and taux_acces_generaux(p) for p in passees],
        "lien": r.get("lien_form_psup"),
    }  # fmt: skip
    return [valeurs[f] for f in FIELDS]


def est_retenue(r: dict, metropole: bool, centre: tuple | None, rayon: float | None) -> bool:
    """Dire si une formation entre dans le fichier : localisee, dans la zone, accessible apres un bac general."""
    g = r.get("g_olocalisation_des_formations") or {}
    lat, lon = g.get("lat"), g.get("lon")
    if lat is None or lon is None:
        return False
    if metropole and not (41 <= lat <= 51.5 and -5.5 <= lon <= 10):
        return False
    if centre and rayon and dist(centre[0], centre[1], lat, lon) > rayon:
        return False
    return r.get("fili") == "CPGE" or not EXCLURE.search(detail_formation(r))


def build_rows(cur, historique=(), internats=None, metropole=True, centre=None, rayon=None):
    """Rendre les lignes triees par identifiant, une par formation retenue.

    Args:
        cur: lignes brutes de la session courante.
        historique: pour chaque session passee, un dict cod_aff_form -> ligne brute.
        internats: dict cod_aff_form -> libelle d'internat de la cartographie.
        metropole: exclure les DROM et l'etranger.
        centre: (lat, lon) du centre de la zone a garder, avec rayon.
        rayon: rayon en km autour de centre.
    """
    rows, seen = [], set()
    for r in cur:
        if not est_retenue(r, metropole, centre, rayon):
            continue
        # Concours communs : la meme ligne est repetee pour chaque site du reseau.
        key = (r.get("g_ea_lib_vx"), detail_formation(r), r.get("capa_fin"), r.get("voe_tot"))
        if key in seen:
            continue
        seen.add(key)
        rows.append(construire_ligne(r, list(historique), internats or {}))
    rows.sort(key=lambda x: x[0])
    return rows


def statistiques_doublettes(lignes: list) -> dict:
    """Rendre, par filiere, la part de propositions des candidats maths + physique-chimie et de tous les candidats."""
    stats = {}
    for filiere in [*FILIERES_CPGE, FORMATION_ING_DOUBLETTES]:
        xs = [x for x in lignes if x.get("formation") == filiere and x.get("niveau_d_agregation") == "2"]
        voeux = sum(x["voeux"] or 0 for x in xs)
        maths_pc = [x for x in xs if set(x.get("doublette") or []) == DOUBLETTE_MATHS_PC]
        if not voeux or not maths_pc:
            continue
        cle = "ING" if filiere == FORMATION_ING_DOUBLETTES else filiere
        stats[cle] = {
            "tauxMathsPC": round(100 * maths_pc[0]["propositions_d_admissions"] / maths_pc[0]["voeux"]),
            "tauxTous": round(100 * sum(x["propositions_d_admissions"] or 0 for x in xs) / voeux),
            "partMathsPC": round(100 * maths_pc[0]["voeux"] / voeux),
        }
    return stats


def valider(rows: list, minimum: int) -> None:
    """Verifier le fichier avant ecriture.

    Raises:
        ValueError: trop peu de lignes, ou champ obligatoire vide.
    """
    if len(rows) < minimum:
        raise ValueError(f"{len(rows)} formations seulement (minimum {minimum}) : telechargement tronque ?")
    index = {f: FIELDS.index(f) for f in CHAMPS_OBLIGATOIRES}
    for row in rows:
        vides = [f for f, i in index.items() if row[i] is None]
        if vides:
            raise ValueError(f"formation {row[0]} : champs vides {vides}")


def ecrire_atomique(chemin: Path, texte: str) -> None:
    """Ecrire via un fichier temporaire puis le renommer, pour ne jamais laisser un JSON tronque."""
    temporaire = chemin.with_suffix(chemin.suffix + ".tmp")
    temporaire.write_text(texte, encoding="utf-8")
    temporaire.replace(chemin)


def charger_historique(session: int) -> tuple[list[dict], list[int]]:
    """Rendre les sessions passees disponibles, de la plus ancienne a la plus recente."""
    historique, sessions = [], []
    for annee in range(session - NB_SESSIONS_HISTORIQUE, session):
        jeu = nom_jeu_session(annee, session)
        try:
            lignes = exporter(jeu, FILTRE_CPGE) + exporter(jeu, FILTRE_ING)
        except urllib.error.HTTPError as exc:  # jeu pas encore ou plus publie : l'historique sera plus court
            print(f"Session {annee} indisponible (HTTP {exc.code}), ignoree.", file=sys.stderr)
            continue
        historique.append({str(r.get("cod_aff_form")): r for r in lignes})
        sessions.append(annee)
    return historique, sessions


def charger_internats(session: int) -> dict:
    """Rendre cod_aff_form -> libelle d'internat, d'apres la cartographie de la meme annee."""
    filtre = f'annee="{session}" and (search("CPGE") or search("ingénieur"))'
    return {str(x["gta"]): " ".join(x["int"]) for x in exporter(JEU_CARTOGRAPHIE, filtre, "gta,int") if x.get("int")}


def charger_doublettes(session: int) -> dict:
    """Rendre les statistiques de doublettes de la session courante, {} si le jeu porte sur une autre session."""
    lignes = exporter(JEU_DOUBLETTES, f'annee_du_bac="{session}" and niveau_d_agregation="2"')
    return statistiques_doublettes(lignes)


def lire_arguments():
    """Rendre les options de la ligne de commande."""
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sortie", default=str(SORTIE_PAR_DEFAUT))
    ap.add_argument("--ville-centre", help="lat,lon : ne garder qu'une zone autour de ce point")
    ap.add_argument("--rayon", type=float, help="rayon en km autour de --ville-centre")
    ap.add_argument("--avec-outre-mer", action="store_true", help="inclure les DROM et l'etranger")
    return ap.parse_args()


def main():
    a = lire_arguments()
    centre = tuple(float(x) for x in a.ville_centre.split(",")) if a.ville_centre else None
    print("Telechargement de la session courante…", file=sys.stderr)
    cur = exporter(JEU_COURANT, FILTRE_CPGE) + exporter(JEU_COURANT, FILTRE_ING)
    if not cur:
        sys.exit("Aucune donnee recue.")
    session = int(cur[0].get("session"))
    historique, sessions = charger_historique(session)
    rows = build_rows(cur, historique, charger_internats(session), not a.avec_outre_mer, centre, a.rayon)
    zone = bool(centre and a.rayon)
    valider(rows, MIN_LIGNES_ZONE if zone else MIN_LIGNES_NATIONAL)
    meta = {
        "session": session, "previousSession": session - 1, "sessionsHist": sessions,
        "source": "https://data.enseignementsup-recherche.gouv.fr/explore/dataset/fr-esr-parcoursup/",
        "licence": "Licence Ouverte / Open Licence (Etalab)",
        "generated": dt.datetime.now(dt.UTC).date().isoformat(), "fields": FIELDS,
        "doublettes": charger_doublettes(session),
    }  # fmt: skip
    if zone:
        meta["coverage"] = {"label": f"{int(a.rayon)} km autour de {centre[0]},{centre[1]}",
                            "center": list(centre), "radiusKm": a.rayon}  # fmt: skip
    texte = json.dumps({"meta": meta, "rows": rows}, ensure_ascii=False, separators=(",", ":")).replace("],[", "],\n[")
    ecrire_atomique(Path(a.sortie), texte + "\n")
    print(
        f"{len(rows)} formations ecrites dans {a.sortie} (session {session}, historique {sessions}).", file=sys.stderr
    )


if __name__ == "__main__":
    main()
