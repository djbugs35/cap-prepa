"""Base des liens vers les resultats aux concours publies par les lycees a prepa (data/liens-resultats.json).

Construite une fois, versionnee, puis completee a la demande (onglet « Donnees », ou cette commande). Pour chaque
lycee, on part de son site (annuaire de l'education) et on explore quelques pages du meme site, en respectant
robots.txt et en marquant une pause entre deux pages, jusqu'a la page qui lie les documents de resultats. Pas de
moteur de recherche : ils refusent les requetes automatiques, on ne les contourne pas.

Exemples :
    python3 scripts/liens.py                   # lycees absents de la base, toute la France
    python3 scripts/liens.py --refaire         # tous les lycees, meme deja explores
"""

import argparse
import datetime as dt
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.robotparser
from pathlib import Path

import debouches as db
import update_data as ud

SORTIE = Path(__file__).resolve().parent.parent / "data" / "liens-resultats.json"
PAGES_MAX = 10  # mesure sur 20 lycees : trouvee en 2 a 4 pages quand elle existe ; 15 pages ne trouvaient rien de plus
PAUSE_S = 0.5
DELAI_S = 10
DUREE_MAX_S = 90  # par lycee : au-dela, un site tres lent bloquerait la construction de la base
# Mots d'un lien vers les resultats (poids fort) ou vers une page qui y mene (CPGE, superieur…).
# « admis » retire : « cpge-admissibilites-session-2026 » passait avant la page des integrations.
MOTS_RESULTATS = ("resultat", "integration", "concours")
MOTS_RELAIS = ("cpge", "prepa", "preparatoire", "superieur", "post bac", "postbac", "formations", "classes")
EXTENSIONS_IGNOREES = re.compile(r"\.(jpe?g|png|gif|svg|pdf|docx?|xlsx?|pptx?|zip|mp4)$", re.IGNORECASE)
STATUTS = ("trouve", "introuvable", "sans-site", "site-injoignable")
# Plans de site usuels (WordPress, Yoast, generique) : ils listent toutes les pages, sans parcourir les menus.
PLANS = ("/wp-sitemap.xml", "/sitemap_index.xml", "/sitemap.xml")
PLANS_MAX = 8  # sous-plans lus au plus : pages et articles suffisent, les plans de pieces jointes sont ignores
CANDIDATES_PLAN = 6  # pages du plan essayees en premier, avant les menus
# Ecoles reconnues exigees pour retenir une page. Mesure sur 31 pages : les fausses (tournoi de foot, tombola,
# mentions legales dont les menus citent « Ecole … ») en donnaient 3 a 6, les vraies 7 a 98.
ECOLES_MIN = 7
DOCUMENTS_MAX = 3  # documents de l'annee la plus recente essayes par page
# Adresses jamais retenues : sur la base complete, les 4 faux positifs restants (resultats du bac, concours d'eloquence,
# journee d'integration, donnees personnelles) avaient 7 ou 8 ecoles, comme de vraies pages qu'un seuil plus haut perdrait.
# Pas « bac » seul : « …/filieres-post-bac/mpsi-mp/resultats… » (La Borde Basse) etait ecartee a tort.
MOTS_EXCLUS_ADRESSE = (
    "baccalaureat", "eloquence", "journee", "donnees personnelles", "mentions legales", "sport", "foot",
    "olympiade", "kangourou", "tombola", "nouvelles", "plaidoirie",
)  # fmt: skip


def _priorite(texte: str) -> int:
    """Rendre l'interet d'un lien : 10 par mot de resultats, 1 par mot de relais, 0 sans interet."""
    return 10 * sum(m in texte for m in MOTS_RESULTATS) + sum(m in texte for m in MOTS_RELAIS)


def meme_site(a: str | None, b: str | None) -> bool:
    """Dire si deux noms d'hote designent le meme site, « www. » mis a part."""
    return bool(a and b) and a.removeprefix("www.") == b.removeprefix("www.")


def liens_a_suivre(page: bytes, base: str, hote: str) -> list[tuple[int, str]]:
    """Rendre [(priorite, url)] des liens internes au site qui peuvent mener aux resultats."""
    suivis = []
    for href, libelle in re.findall(rb'<a[^>]+href="([^"#]+)"[^>]*>(.*?)</a>', page, flags=re.DOTALL):
        url = db.adresse_propre(base, href.decode("utf-8", "replace"))
        if not meme_site(urllib.parse.urlparse(url).hostname, hote) or EXTENSIONS_IGNOREES.search(url.split("?")[0]):
            continue
        texte = db.normaliser(
            urllib.parse.unquote(url) + " " + re.sub(rb"<[^>]+>", b" ", libelle).decode("utf-8", "replace")
        )
        if priorite := _priorite(texte):
            suivis.append((priorite, url))
    return suivis


def priorite_plan(url: str) -> int:
    """Rendre l'interet d'une page du plan du site, d'apres le dernier segment de son adresse.

    Une page de resultats a une adresse courte (« les-resultats-de-sessions ») ; une actualite a un long titre suivi
    d'un numero (« changement-de-regime-…-lors-des-ecrits-aux-concours-28498 ») : chaque mot coute un point.
    """
    segment = db.normaliser(urllib.parse.unquote(urllib.parse.urlparse(url).path.rstrip("/").rsplit("/", 1)[-1]))
    mots = segment.split()
    forts = sum(m in segment for m in ("resultat", "integration"))
    moyens = sum(m in segment for m in ("concours", "session", "debouche"))
    return 10 * forts + 4 * moyens - len(mots) - (5 if mots and mots[-1].isdigit() else 0)


def pages_du_plan(racine: str, regles, journal=print) -> list[tuple[int, str]]:
    """Rendre [(priorite, url)] des pages du plan du site (sitemap) qui peuvent mener aux resultats, [] sans plan."""
    hote = urllib.parse.urlparse(racine).hostname
    a_lire, lus, pages = [urllib.parse.urljoin(racine, p) for p in PLANS], 0, []
    while a_lire and lus < PLANS_MAX:
        plan = a_lire.pop(0)
        if regles and not regles.can_fetch(db.AGENT, plan):
            continue
        try:
            brut, _, _ = db.telecharger_suivi(plan, delai=DELAI_S, essais=1)
        except db.ERREURS_RESEAU:
            continue
        if b"<loc>" not in brut:
            continue
        lus += 1
        for loc in re.findall(rb"<loc>\s*([^<\s]+)\s*</loc>", brut):
            url = html.unescape(loc.decode("utf-8", "replace"))
            if url.endswith(".xml"):
                if "attachment" not in url and "tag" not in url and url not in a_lire:
                    a_lire.append(url)
            elif meme_site(urllib.parse.urlparse(url).hostname, hote) and (p := priorite_plan(url)) > 0:
                pages.append((p, url))
        if pages and plan.endswith(PLANS):
            a_lire = [
                u for u in a_lire if not u.endswith(PLANS)
            ]  # un plan racine trouve : inutile d'essayer les autres
    pages.sort(key=lambda x: -x[0])
    journal(f"  plan du site : {len(pages)} pages candidates")
    # Priorite haussee : les meilleures pages du plan passent avant les liens de menu (priorites de 1 a ~30).
    return [(100 + p, u) for p, u in pages[:CANDIDATES_PLAN]]


def _ecoles_reconnues(texte: str) -> int:
    """Rendre le nombre d'ecoles d'ingenieurs reconnues parmi les couples « nom effectif » du texte."""
    return sum(1 for e in db.extraire_integrations(texte, None) if db.est_nom_d_ecole(e["ecole"]))


def est_adresse_exclue(url: str) -> bool:
    """Dire si l'adresse designe une page qui n'est pas celle des resultats aux concours (bac, sport, mentions…)."""
    texte = " " + db.normaliser(urllib.parse.unquote(url)) + " "
    return any(m in texte for m in MOTS_EXCLUS_ADRESSE)


def verifier_resultats(brut: bytes, url: str, journal=print) -> dict | None:
    """Rendre {document, annee, ecoles} si la page ou son document de resultats le plus recent donne au moins
    ECOLES_MIN ecoles reconnues (le meilleur des deux) ; None sinon.

    Les deux sont lus : la page seule s'arretait sur 3 ecoles tirees des menus, quand son PDF en donnait 98.
    """
    meilleur = {"document": url, "annee": None, "ecoles": _ecoles_reconnues(db.texte_html(brut))}
    documents = [d for d in db.liens_resultats(brut, url) if d[0]]
    # Un document par filiere (Chatelet : MP, PSI*, BCPST) : le premier peut etre illisible quand un autre ne l'est pas.
    for annee, document in [d for d in documents if d[0] == documents[0][0]][:DOCUMENTS_MAX] if documents else []:
        try:
            texte, _, _ = db._texte_document(document)
        except db.ERREURS_RESEAU as exc:
            journal(f"  {document} : {exc}")
            continue
        ecoles = _ecoles_reconnues(texte or "")
        if ecoles > meilleur["ecoles"]:
            meilleur = {"document": document, "annee": annee, "ecoles": ecoles}
    return meilleur if meilleur["ecoles"] >= ECOLES_MIN else None


def _robots(racine: str) -> urllib.robotparser.RobotFileParser | None:
    """Rendre les regles robots.txt du site, None si elles sont illisibles (tout est alors permis).

    Lu par telecharger_suivi et non par RobotFileParser.read, qui n'a pas de delai : le site du lycee militaire
    d'Aix-en-Provence, qui ne repond pas, a bloque la construction de la base pendant 19 minutes.
    """
    try:
        brut, _, _ = db.telecharger_suivi(urllib.parse.urljoin(racine, "/robots.txt"), delai=DELAI_S, essais=1)
    except db.ERREURS_RESEAU:
        return None
    regles = urllib.robotparser.RobotFileParser()
    regles.parse(brut.decode("utf-8", "replace").splitlines())
    return regles


def explorer_site(site: str, journal=print, pause: float = PAUSE_S) -> dict:
    """Rendre {statut, lien, document, annee, pages} pour un site de lycee.

    lien : page qui lie le document de resultats le plus recent (document) ; annee : celle de ce document.
    """
    racine = site if site.startswith("http") else "http://" + site
    try:  # adresse finale d'abord : l'annuaire donne souvent une ancienne adresse, et le plan du site est sur la nouvelle
        racine = db.telecharger_suivi(racine, delai=DELAI_S, essais=1)[2]
    except db.ERREURS_RESEAU:
        return {"statut": "site-injoignable", "lien": None, "pages": 1}
    hote, regles = urllib.parse.urlparse(racine).hostname, _robots(racine)
    file, vues, pages, joignable = [(0, racine), *pages_du_plan(racine, regles, journal)], set(), 0, False
    debut = time.monotonic()
    while file and pages < PAGES_MAX and time.monotonic() - debut < DUREE_MAX_S:
        file.sort(key=lambda x: -x[0])
        _, url = file.pop(0)
        if url in vues or (regles and not regles.can_fetch(db.AGENT, url)):
            continue
        vues.add(url)
        pages += 1
        try:
            brut, mime, finale = db.telecharger_suivi(url, delai=DELAI_S, essais=1)
        except db.ERREURS_RESEAU as exc:
            journal(f"  {url} : {exc}")
            continue
        if not joignable:
            # L'annuaire donne souvent une ancienne adresse (livet.e-lyco.fr -> livet.paysdelaloire.e-lyco.fr) :
            # le site de reference est celui ou l'on arrive, sinon tous ses liens etaient ecartes.
            hote = urllib.parse.urlparse(finale).hostname or hote
        joignable = True
        url = finale
        if mime == "text/html":
            if (
                not est_adresse_exclue(url)
                and any(m in db.normaliser(urllib.parse.unquote(url)) for m in MOTS_RESULTATS)
                and (verifie := verifier_resultats(brut, url, journal))
            ):
                return {"statut": "trouve", "lien": url, **verifie, "pages": pages}
            file += [(p, u) for p, u in liens_a_suivre(brut, url, hote) if u not in vues]
        time.sleep(pause)
    return {"statut": "introuvable" if joignable else "site-injoignable", "lien": None, "pages": pages}


def lycees_a_prepa(dossier: Path) -> dict:
    """Rendre UAI -> {lycee, ville, site, prepas, filieres} des lycees qui ont une prepa visee, d'apres les sources.

    Raises:
        ud.SourceAbsente: sources Parcoursup ou annuaire non telechargees.
    """
    sources = {s["cle"]: s for s in ud.definir_sources(ud.session_locale(dossier))}
    parcoursup, annuaire = (
        ud.lire_source(dossier, sources[ud.CLE_COURANTE]),
        ud.lire_source(dossier, sources.get("lycees", {})),
    )
    if not parcoursup or not annuaire:
        raise ud.SourceAbsente("sources Parcoursup et lycees requises : mettez les donnees a jour d'abord")
    sites = {x["identifiant_de_l_etablissement"]: x.get("web") for x in annuaire["lignes"]}
    lycees = {}
    for r in parcoursup["lignes"]:
        if r.get("fili") != "CPGE" or r.get("fil_lib_voe_acc") not in ud.FILIERES_CPGE or not r.get("cod_uai"):
            continue
        entree = lycees.setdefault(r["cod_uai"], {"lycee": ud.clean(r.get("g_ea_lib_vx")), "ville": ud.clean(r.get("ville_etab")),
                                                  "site": sites.get(r["cod_uai"]), "prepas": [], "filieres": []})  # fmt: skip
        entree["prepas"].append(int(r["cod_aff_form"]))
        if r["fil_lib_voe_acc"] not in entree["filieres"]:
            entree["filieres"].append(r["fil_lib_voe_acc"])
    return lycees


def charger_base(chemin: Path = SORTIE) -> dict:
    """Rendre la base de liens, vide si le fichier n'existe pas encore."""
    if not chemin.exists():
        return {"meta": {"source": "sites des lycees (annuaire de l'education)", "maj": None}, "lycees": {}}
    return json.loads(chemin.read_text(encoding="utf-8"))


def completer_base(dossier: Path, uais: list[str] | None = None, refaire: bool = False, chemin: Path = SORTIE,
                   journal=print, pause: float = PAUSE_S) -> dict:  # fmt: skip
    """Explorer les lycees demandes (tous si uais vaut None) et rendre la base mise a jour.

    Sans refaire, un lycee deja dans la base n'est pas re-explore. La base est ecrite apres chaque lycee : une
    exploration interrompue garde ce qui a ete trouve.
    """
    lycees, base = lycees_a_prepa(dossier), charger_base(chemin)
    cibles = [u for u in (uais if uais is not None else lycees) if u in lycees and (refaire or u not in base["lycees"])]
    for i, uai in enumerate(cibles, 1):
        info = lycees[uai]
        journal(f"[{i}/{len(cibles)}] {info['lycee']} ({info['ville']})")
        resultat = (
            explorer_site(info["site"], journal, pause) if info["site"] else {"statut": "sans-site", "lien": None}
        )
        base["lycees"][uai] = {**info, **resultat, "verifie": dt.datetime.now(dt.UTC).date().isoformat()}
        base["meta"]["maj"] = dt.datetime.now(dt.UTC).isoformat(timespec="seconds")
        ud.ecrire_atomique(chemin, json.dumps(base, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    return base


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refaire", action="store_true", help="re-explorer aussi les lycees deja dans la base")
    a = ap.parse_args()
    try:
        base = completer_base(ud.DOSSIER_SOURCES, refaire=a.refaire, journal=lambda m: print(m, file=sys.stderr))
    except ud.SourceAbsente as exc:
        sys.exit(str(exc))
    statuts = [x["statut"] for x in base["lycees"].values()]
    print({s: statuts.count(s) for s in STATUTS}, file=sys.stderr)


if __name__ == "__main__":
    main()
