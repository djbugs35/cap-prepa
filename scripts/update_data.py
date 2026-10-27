"""Regenerer data/formations.json a partir de l'open data Parcoursup.

Sources (Licence Ouverte, data.enseignementsup-recherche.gouv.fr) :
- fr-esr-parcoursup et fr-esr-parcoursup_<annee> : statistiques par formation, session courante et historique ;
- fr-esr-cartographie_formations_parcoursup : internat des CPGE ;
- fr-esr-parcoursup-enseignements-de-specialite-bacheliers-generaux-3 : propositions par doublette de specialites.

Aucune dependance hors bibliotheque standard.

Les exports bruts sont gardes dans data/sources/ (hors git) : --hors-ligne reconstruit sans reseau.

Exemples :
    python3 scripts/update_data.py                                         # toute la France metropolitaine
    python3 scripts/update_data.py --hors-ligne                            # depuis les sources deja telechargees
    python3 scripts/update_data.py --ville-centre 48.111,-1.68 --rayon 400  # une zone seulement
"""

import argparse
import datetime as dt
import gzip
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
# Exports bruts de chaque jeu, gardes en local (hors git) pour reconstruire sans reseau et suivre leurs versions.
DOSSIER_SOURCES = Path(__file__).resolve().parent.parent / "data" / "sources"
CLE_COURANTE = "parcoursup"
SORTIE_LYCEES = Path(__file__).resolve().parent.parent / "data" / "lycees.json"
# Annuaire de l'education (Licence Ouverte) : lycees d'origine possibles, avec leur academie.
API_EDUCATION = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/"
JEU_LYCEES = "fr-en-annuaire-education"
FILTRE_LYCEES = 'type_etablissement="Lycée" and voie_generale="1" and etat="OUVERT"'
# web : site du lycee, point de depart de scripts/liens.py pour trouver sa page de resultats aux concours.
CHAMPS_LYCEES = "identifiant_de_l_etablissement,nom_etablissement,nom_commune,code_departement,libelle_academie,latitude,longitude,statut_public_prive,web"
# InserSup (Licence Ouverte) : insertion des diplomes ingenieurs, une ligne « tout diplome » par etablissement.
JEU_INSERSUP = "fr-esr-insersup"
FILTRE_INSERSUP = (
    'type_diplome="Formation ingénieur" and diplome="all" and genre="ensemble" and nationalite="ensemble" '
    'and regime_inscription="ensemble" and obtention_diplome="diplômé"'
)
CHAMPS_INSERSUP = "etablissement,uo_lib,promo,tx_sortants_en_emploi_sal_fr_18,salaire_q2_18"
FIELDS_LYCEES = ["uai", "nom", "commune", "dep", "academie", "lat", "lon", "public"]
HTTP_ABSENT = 404

# Public vise : terminale generale maths + physique-chimie. TSI, TB, TPC (bacs technologiques) sont hors perimetre.
FILIERES_CPGE = ["MPSI", "MP2I", "PCSI", "PTSI", "BCPST"]
# Effectifs reels en CPGE (data.education.gouv.fr, Licence Ouverte) : taille des promos de 1re annee et classes etoilees.
JEU_EFFECTIFS_CPGE = "fr-esr-effectifs-d-etudiants-inscrits-en-classes-preparatoires-aux-grandes-ecole"
# Filiere -> debut du libelle de specialite de 1re annee dans ce jeu (« MPSI (MATH…) », « MP2I S1 (…) »).
SPECIALITE_1RE = {"MPSI": "MPSI", "MP2I": "MP2I", "PCSI": "PCSI", "PTSI": "PTSI", "BCPST": "BCPST"}
# Filiere -> bases des classes etoilees de 2e annee qui la prolongent (« MP * » -> base « MP »). BCPST n'a pas d'etoilee.
ETOILEES_SUITE = {
    "MPSI": {"MP", "MPI", "PSI"},
    "MP2I": {"MPI", "MP"},
    "PCSI": {"PC", "PSI"},
    "PTSI": {"PT", "PSI"},
    "BCPST": set(),
}
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
    "internat", "pAcaOrig", "admis", "tauxHist", "tauxGenHist", "lien", "academie",
    "insEmploi", "insSalaire", "insPromo", "uai", "effectif", "pFcpge", "etoilee",
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
                corps = reponse.read()
                # Le catalogue repond en gzip meme sans Accept-Encoding : json.load echouait sur l'octet 0x8b.
                if reponse.headers.get("Content-Encoding") == "gzip":
                    corps = gzip.decompress(corps)
                return json.loads(corps)
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or essai == essais - 1:
                raise
        except urllib.error.URLError:
            if essai == essais - 1:
                raise
        time.sleep(2**essai)
    raise AssertionError("inatteignable")


def exporter(jeu: str, filtre: str, champs: str | None = None, api: str = API) -> list:
    """Rendre toutes les lignes d'un jeu de donnees qui passent le filtre ODSQL."""
    parametres = {"where": filtre}
    if champs:
        parametres["select"] = champs
    return telecharger_json(api + jeu + "/exports/json?" + urllib.parse.urlencode(parametres))


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


def construire_ligne(r: dict, historique: list[dict], internats: dict, insertion=None, effectifs=None) -> list:
    """Rendre la ligne compacte d'une formation, dans l'ordre de FIELDS."""
    cle = str(r.get("cod_aff_form"))
    passees = [h.get(cle) for h in historique]
    # Ecoles seulement, et par UAI strict : un campus rattache ailleurs reste sans chiffre plutot qu'avec celui d'un autre.
    ins = (insertion or {}).get(r.get("cod_uai"), {}) if r.get("fili") != "CPGE" else {}
    # Effectifs reels d'une CPGE, par UAI et filiere ; rien pour les ecoles d'ingenieurs.
    eff = (effectifs or {}).get((r.get("cod_uai"), r.get("fil_lib_voe_acc")), {}) if r.get("fili") == "CPGE" else {}
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
        "lien": r.get("lien_form_psup"), "academie": r.get("acad_mies"),
        "insEmploi": ins.get("emploi"), "insSalaire": ins.get("salaire"), "insPromo": ins.get("promo"),
        "uai": r.get("cod_uai"),
        "effectif": eff.get("eleves"), "pFcpge": eff.get("partF"), "etoilee": eff.get("etoilee"),
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


def build_rows(  # noqa: PLR0913 (sources et filtres distincts, tous facultatifs)
    cur, historique=(), internats=None, metropole=True, centre=None, rayon=None, *, insertion=None, effectifs=None
):
    """Rendre les lignes triees par identifiant, une par formation retenue.

    Args:
        cur: lignes brutes de la session courante.
        historique: pour chaque session passee, un dict cod_aff_form -> ligne brute.
        internats: dict cod_aff_form -> libelle d'internat de la cartographie.
        insertion: dict UAI -> indicateurs InserSup (voir indicateurs_insertion).
        effectifs: dict (UAI, filiere) -> effectifs reels en CPGE (voir indicateurs_effectifs).
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
        rows.append(construire_ligne(r, list(historique), internats or {}, insertion, effectifs))
    rows.sort(key=lambda x: x[0])
    return rows


def _nombre(x) -> float | None:
    """Rendre x en nombre ; None pour « nd » (non diffuse, effectif trop faible) ou une valeur absente."""
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _plus_recent(lignes: list, champ: str) -> dict:
    """Rendre UAI -> (promo, valeur) de la promotion la plus recente ou champ est diffuse."""
    retenues = {}
    for x in lignes:
        valeur, promo = _nombre(x.get(champ)), max(x.get("promo") or [""])
        if valeur is not None and promo > retenues.get(x["etablissement"], ("", None))[0]:
            retenues[x["etablissement"]] = (promo, round(valeur))
    return retenues


def indicateurs_effectifs(lignes: list) -> dict:
    """Rendre (UAI, filiere) -> {eleves, partF, etoilee} des effectifs reels en CPGE.

    eleves : nombre d'etudiants de 1re annee ; partF : part de filles (%) ; etoilee : une classe etoilee (2e annee)
    prolonge cette filiere dans ce lycee. filiere est le libelle Parcoursup (MPSI, MP2I, PCSI, PTSI, BCPST).
    """
    promos: dict = {}
    etoilees: dict[str, set] = {}
    for x in lignes:
        uai, spec, n = x.get("uai"), (x.get("specialite") or "").strip(), _nombre(x.get("nombre_d_eleves")) or 0
        if not uai or not n:
            continue
        if x.get("degre_d_etudes") == "2" and "*" in spec:
            etoilees.setdefault(uai, set()).add(spec.split("*")[0].strip())  # « MP * (…) » -> base « MP »
        if x.get("degre_d_etudes") != "1":
            continue
        for fil, debut in SPECIALITE_1RE.items():
            if spec.startswith(debut):
                cle = promos.setdefault((uai, fil), {"eleves": 0, "filles": 0})
                cle["eleves"] += n
                if x.get("sexe") == "F":
                    cle["filles"] += n
                break
    out = {}
    for (uai, fil), v in promos.items():
        etoilee = bool(etoilees.get(uai, set()) & ETOILEES_SUITE[fil])
        out[(uai, fil)] = {
            "eleves": round(v["eleves"]),
            "partF": round(100 * v["filles"] / v["eleves"]),
            "etoilee": etoilee,
        }
    return out


def indicateurs_insertion(lignes: list) -> dict:
    """Rendre UAI -> {emploi, salaire, promo}, chaque indicateur pris dans la derniere promotion qui le diffuse.

    emploi : % de diplomes en emploi salarie en France a 18 mois ; salaire : salaire net mensuel median a 18 mois,
    souvent « nd » pour la derniere promotion, d'ou une recherche separee ; promo : celle du taux d'emploi.
    """
    emplois, salaires = _plus_recent(lignes, "tx_sortants_en_emploi_sal_fr_18"), _plus_recent(lignes, "salaire_q2_18")
    return {
        uai: {"emploi": emploi, "salaire": salaires.get(uai, (None, None))[1], "promo": promo}
        for uai, (promo, emploi) in emplois.items()
    }


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


class SourceAbsente(Exception):
    """Fichier de source local manquant : il faut d'abord le telecharger."""


def definir_sources(session: int | None) -> list[dict]:
    """Rendre les sources d'une session : cle stable, jeu de donnees, role et requetes (filtre ODSQL, champs).

    La premiere est toujours la session courante, dont on tire la session des autres ; sans elle (session None),
    seule cette premiere source est rendue.
    """
    requetes_parcoursup = [(FILTRE_CPGE, None), (FILTRE_ING, None)]
    sources = [{"cle": CLE_COURANTE, "jeu": JEU_COURANT, "role": "Statistiques par formation, dernière session",
                "requetes": requetes_parcoursup}]  # fmt: skip
    if session is None:
        return sources
    for recul in range(NB_SESSIONS_HISTORIQUE, 0, -1):  # de la plus ancienne a la plus recente
        annee = session - recul
        sources.append({"cle": f"parcoursup-n{recul}", "jeu": nom_jeu_session(annee, session), "session": annee,
                        "role": f"Historique, session {annee}", "requetes": requetes_parcoursup})  # fmt: skip
    filtre_internats = f'annee="{session}" and (search("CPGE") or search("ingénieur"))'
    sources.append({"cle": "internats", "jeu": JEU_CARTOGRAPHIE, "role": f"Internats des CPGE, {session}",
                    "requetes": [(filtre_internats, "gta,int")]})  # fmt: skip
    sources.append({"cle": "lycees", "jeu": JEU_LYCEES, "api": API_EDUCATION, "role": "Lycées d'origine (annuaire de l'éducation)",
                    "requetes": [(FILTRE_LYCEES, CHAMPS_LYCEES)]})  # fmt: skip
    sources.append({"cle": "insersup", "jeu": JEU_INSERSUP, "role": "Insertion des diplômés ingénieurs (InserSup)",
                    "requetes": [(FILTRE_INSERSUP, CHAMPS_INSERSUP)]})  # fmt: skip
    annee_scolaire = f"{session}-{session + 1}"  # rentree qui suit la session Parcoursup : CPGE 2025-2026 pour 2025
    sources.append({"cle": "effectifs-cpge", "jeu": JEU_EFFECTIFS_CPGE,
                    "role": f"Effectifs réels en CPGE, {annee_scolaire}",
                    "requetes": [(f'filiere="scientifique" and annee_scolaire="{annee_scolaire}"',
                                  "uai,specialite,degre_d_etudes,sexe,nombre_d_eleves")]})  # fmt: skip
    sources.append({"cle": "doublettes", "jeu": JEU_DOUBLETTES, "role": f"Propositions par doublette de spécialités, {session}",
                    "requetes": [(f'annee_du_bac="{session}" and niveau_d_agregation="2"', None)]})  # fmt: skip
    return sources


def version_distante(jeu: str, api: str = API) -> dict:
    """Rendre le titre, la date de modification et le nombre total de lignes publies pour un jeu de donnees.

    On retient `modified` et non `data_processed` : la cartographie est retraitee presque chaque jour sans
    changement de contenu, elle paraitrait sinon toujours a mettre a jour.
    """
    metas = telecharger_json(api + jeu)["metas"]["default"]
    return {"titre": metas.get("title"), "modifie": metas.get("modified"), "lignesPubliees": metas.get("records_count")}


def chemin_source(dossier: Path, cle: str) -> Path:
    """Rendre le fichier local d'une source."""
    return dossier / f"{cle}.json"


def telecharger_source(source: dict, dossier: Path) -> None:
    """Telecharger une source et l'ecrire dans dossier, avec sa version distante et la date du telechargement."""
    lignes = []
    api = source.get("api", API)
    for filtre, champs in source["requetes"]:
        lignes += exporter(source["jeu"], filtre, champs, api)
    contenu = {"cle": source["cle"], "jeu": source["jeu"], "telecharge": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
               **version_distante(source["jeu"], api), "lignes": lignes}  # fmt: skip
    dossier.mkdir(parents=True, exist_ok=True)
    ecrire_atomique(chemin_source(dossier, source["cle"]), json.dumps(contenu, ensure_ascii=False))


def lire_source(dossier: Path, source: dict) -> dict | None:
    """Rendre le contenu local d'une source, None s'il manque ou vient d'un autre jeu (session courante changee)."""
    chemin = chemin_source(dossier, source["cle"])
    if not chemin.exists():
        return None
    contenu = json.loads(chemin.read_text(encoding="utf-8"))
    return contenu if contenu.get("jeu") == source["jeu"] else None


def session_locale(dossier: Path) -> int | None:
    """Rendre la session de la source courante telechargee, None si elle manque."""
    contenu = lire_source(dossier, definir_sources(None)[0])
    return int(contenu["lignes"][0]["session"]) if contenu and contenu["lignes"] else None


def mettre_a_jour_sources(dossier: Path, cles: list[str] | None = None, journal=print) -> int:
    """Telecharger les sources demandees (toutes si cles vaut None) et rendre la session courante.

    La source courante est telechargee d'abord si elle est demandee ou absente : elle fixe la session des autres.
    Un historique pas encore ou plus publie (HTTP 404) est ignore, l'historique sera plus court.

    Raises:
        urllib.error.URLError: reseau indisponible apres les reprises, ou erreur HTTP sur une source indispensable.
    """
    courante = definir_sources(None)[0]
    if cles is None or CLE_COURANTE in cles or session_locale(dossier) is None:
        journal(f"Téléchargement : {courante['role']} ({courante['jeu']})")
        telecharger_source(courante, dossier)
    session = session_locale(dossier)
    for source in definir_sources(session)[1:]:
        if cles is not None and source["cle"] not in cles:
            continue
        journal(f"Téléchargement : {source['role']} ({source['jeu']})")
        try:
            telecharger_source(source, dossier)
        except urllib.error.HTTPError as exc:
            if not source["cle"].startswith("parcoursup-n") or exc.code != HTTP_ABSENT:
                raise
            journal(f"{source['jeu']} indisponible (HTTP {exc.code}), ignoré.")
    return session


def etat_sources(dossier: Path, verifier: bool = False) -> dict:
    """Rendre la session locale et, pour chaque source, ce qui est en local et, si verifier, la version publiee.

    Raises:
        urllib.error.URLError: verifier demande et catalogue injoignable.
    """
    session = session_locale(dossier)
    etats = []
    for source in definir_sources(session):
        contenu = lire_source(dossier, source)
        chemin = chemin_source(dossier, source["cle"])
        etat = {"cle": source["cle"], "jeu": source["jeu"], "role": source["role"], "present": contenu is not None}
        if contenu:
            etat |= {k: contenu.get(k) for k in ("titre", "modifie", "telecharge")}
            etat |= {"lignes": len(contenu["lignes"]), "octets": chemin.stat().st_size}
        if verifier:
            distante = version_distante(source["jeu"], source.get("api", API))
            etat["modifieDistant"] = distante["modifie"]
            etat["aJour"] = bool(contenu) and contenu.get("modifie") == distante["modifie"]
        etats.append(etat)
    return {"session": session, "sources": etats}


def construire_formations(dossier: Path, centre=None, rayon=None, metropole=True) -> tuple[str, dict]:
    """Rendre le texte de formations.json construit depuis les sources locales, et son meta.

    Raises:
        SourceAbsente: la source courante n'a pas ete telechargee.
        ValueError: fichier trop court ou incomplet (voir valider).
    """
    sources = {s["cle"]: s for s in definir_sources(session_locale(dossier))}
    courante = lire_source(dossier, sources[CLE_COURANTE])
    if not courante:
        raise SourceAbsente("source courante absente : lancer d'abord le telechargement")
    session = int(courante["lignes"][0]["session"])
    historique, sessions = [], []
    for source in (s for s in sources.values() if "session" in s):
        contenu = lire_source(dossier, source)
        if contenu:
            historique.append({str(r.get("cod_aff_form")): r for r in contenu["lignes"]})
            sessions.append(source["session"])
    internats = {
        str(x["gta"]): " ".join(x["int"])
        for x in (lire_source(dossier, sources["internats"]) or {}).get("lignes", [])
        if x.get("int")
    }
    doublettes = statistiques_doublettes((lire_source(dossier, sources["doublettes"]) or {}).get("lignes", []))
    insertion = indicateurs_insertion((lire_source(dossier, sources["insersup"]) or {}).get("lignes", []))
    effectifs = indicateurs_effectifs((lire_source(dossier, sources["effectifs-cpge"]) or {}).get("lignes", []))
    rows = build_rows(
        courante["lignes"], historique, internats, metropole, centre, rayon, insertion=insertion, effectifs=effectifs
    )
    zone = bool(centre and rayon)
    valider(rows, MIN_LIGNES_ZONE if zone else MIN_LIGNES_NATIONAL)
    meta = {
        "session": session, "previousSession": session - 1, "sessionsHist": sessions,
        "source": "https://data.enseignementsup-recherche.gouv.fr/explore/dataset/fr-esr-parcoursup/",
        "licence": "Licence Ouverte / Open Licence (Etalab)",
        "generated": dt.datetime.now(dt.UTC).date().isoformat(), "fields": FIELDS, "doublettes": doublettes,
    }  # fmt: skip
    if zone:
        meta["coverage"] = {"label": f"{int(rayon)} km autour de {centre[0]},{centre[1]}",
                            "center": list(centre), "radiusKm": rayon}  # fmt: skip
    texte = json.dumps({"meta": meta, "rows": rows}, ensure_ascii=False, separators=(",", ":")).replace("],[", "],\n[")
    return texte + "\n", meta | {"formations": len(rows)}


def construire_lycees(dossier: Path) -> str | None:
    """Rendre le texte de lycees.json depuis la source locale, None si elle n'a pas ete telechargee."""
    session = session_locale(dossier)
    source = next((s for s in definir_sources(session) if s["cle"] == "lycees"), None)
    contenu = lire_source(dossier, source) if source else None
    if not contenu:
        return None
    lignes = [
        [x["identifiant_de_l_etablissement"], clean(x["nom_etablissement"]), clean(x["nom_commune"]), x.get("code_departement"),
         x.get("libelle_academie"), round(x["latitude"], 4), round(x["longitude"], 4), 1 if x.get("statut_public_prive") == "Public" else 0]
        for x in contenu["lignes"] if x.get("latitude") is not None and x.get("longitude") is not None
    ]  # fmt: skip
    lignes.sort(key=lambda x: (x[1], x[2]))
    meta = {"source": "https://data.education.gouv.fr/explore/dataset/fr-en-annuaire-education/",
            "licence": "Licence Ouverte / Open Licence (Etalab)", "version": contenu.get("modifie"), "fields": FIELDS_LYCEES}  # fmt: skip
    texte = json.dumps({"meta": meta, "rows": lignes}, ensure_ascii=False, separators=(",", ":")).replace(
        "],[", "],\n["
    )
    return texte + "\n"


def ecrire_lycees(dossier: Path, sortie: Path = SORTIE_LYCEES) -> bool:
    """Ecrire lycees.json depuis la source locale ; rendre False si la source manque (fichier precedent garde)."""
    texte = construire_lycees(dossier)
    if texte is None:
        return False
    ecrire_atomique(sortie, texte)
    return True


def lire_arguments():
    """Rendre les options de la ligne de commande."""
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sortie", default=str(SORTIE_PAR_DEFAUT))
    ap.add_argument("--sources", default=str(DOSSIER_SOURCES), help="dossier des sources telechargees")
    ap.add_argument("--hors-ligne", action="store_true", help="reconstruire depuis les sources deja telechargees")
    ap.add_argument("--ville-centre", help="lat,lon : ne garder qu'une zone autour de ce point")
    ap.add_argument("--rayon", type=float, help="rayon en km autour de --ville-centre")
    ap.add_argument("--avec-outre-mer", action="store_true", help="inclure les DROM et l'etranger")
    return ap.parse_args()


def main():
    a = lire_arguments()
    centre = tuple(float(x) for x in a.ville_centre.split(",")) if a.ville_centre else None
    dossier = Path(a.sources)
    if not a.hors_ligne:
        mettre_a_jour_sources(dossier, journal=lambda m: print(m, file=sys.stderr))
    try:
        texte, meta = construire_formations(dossier, centre, a.rayon, not a.avec_outre_mer)
    except SourceAbsente as exc:
        sys.exit(str(exc))
    ecrire_atomique(Path(a.sortie), texte)
    if ecrire_lycees(dossier):
        print(f"Lycees ecrits dans {SORTIE_LYCEES}.", file=sys.stderr)
    print(f"{meta['formations']} formations ecrites dans {a.sortie} (session {meta['session']}, "
          f"historique {meta['sessionsHist']}).", file=sys.stderr)  # fmt: skip


if __name__ == "__main__":
    main()
