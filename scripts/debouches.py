"""Chercher les debouches d'une prepa : ecoles integrees, d'apres les resultats publies par le lycee.

Aucune source ouverte ne les publie par lycee depuis 2021. L'utilisateur trouve la page de resultats du lycee
(recherche ouverte dans son navigateur : les moteurs refusent les requetes automatiques, on ne les contourne pas),
colle son adresse, et on en extrait les couples « ecole effectif », en suivant au besoin le lien vers le document
le plus recent. Le resultat est une proposition a valider : chaque lycee a son format, l'extraction peut manquer
des ecoles ou en mal lire.

Lecture des PDF : PDFKit de macOS (via osascript), sinon pdftotext s'il est installe ; sans l'un ni l'autre, les
PDF sont signales comme illisibles. Bibliotheque standard uniquement.
"""

import html
import http.client
import re
import shutil
import subprocess
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

AGENT = "cap-prepa/1.2 (outil local d'aide aux voeux ; lecture a la demande d'une page de resultats)"
# Palmares sans licence de reutilisation : on ne l'extrait pas (la fiche y renvoie par un lien).
DOMAINES_EXCLUS = ("letudiant.fr",)
TAILLE_MAX = 8_000_000  # un PDF de resultats fait moins de 1 Mo ; au-dela, ce n'en est probablement pas un
DELAI_S = 20
ESSAIS_RESEAU = 3
EFFECTIF_MAX = 150  # au-dela, le nombre lu est une annee, un code postal ou un total, pas un effectif d'ecole
# Filieres de 2e annee ou se retrouvent les eleves de chaque 1re annee (meme regle que SUITES dans src/calc.js).
SUITES = {
    "MPSI": ["MP", "MPI", "PSI"],
    "MP2I": ["MPI", "MP"],
    "PCSI": ["PC", "PSI"],
    "PTSI": ["PT", "PSI"],
    "BCPST": ["BCPST"],
}
# Totaux de banques de concours et lignes de synthese : ce ne sont pas des ecoles.
NOMS_EXCLUS = {
    "x ens", "autres", "autre", "ccinp", "ccp", "centrale", "banque centrale", "mines", "mines ponts", "mines telecom",
    "e3a", "e3a polytech", "polytech", "concours commun inp", "total", "doublants", "redoublants", "ens", "ecoles", "ecole",
}  # fmt: skip
# « aucune ecole demandee », « demission en janvier » : lignes des listes nominatives qui ne sont pas des integrations.
MOTS_EXCLUS = (
    "integr", "etudiant", "doublant", "candidat", "admissib", "session", "concours", "filiere", "lycee",
    "aucune", "demission", "abandon", "prenom",
)  # fmt: skip
# Ponctuation retiree autour d'un nom ; chr(0x2013) : tiret demi-cadratin, frequent dans les PDF.
PONCTUATION_BORD = " -:;,.()" + chr(0x2013)
MOTS_LIEN = ("resultat", "integration", "concours", "session", "debouche")
# « Filiere MP » (Clemenceau) ou « Resultats PSI 2024 », « Resultats d'admission - MP 2024 » (Chatelet, La Fayette).
SECTION = re.compile(
    r"^\s*(?:fili[eè]re|r[ée]sultats(?:\s+d.admission)?\s*-?)\s+(MPI|MP|PSI|PC|PT|BCPST)\b", re.IGNORECASE
)
COUPLE = re.compile(r"([^\d%\n]*?[A-Za-zÀ-ÿ][^\d%\n]*?)\s+(\d{1,3})(?=\s|$)")


# Mots qui signent une ecole d'ingenieurs ou une grande ecole scientifique (debut de mot, sans accents).
MOTS_ECOLES = (
    "centrale", "mines", "polytech", "insa", "ens", "ecole", "institut", "isae", "supaero", "supelec", "telecom", "arts et metiers",
    "imt", "inp", "utc", "utt", "utbm", "agro", "ponts", "chimie", "enac", "enib", "enit", "eseo", "estp", "isen", "icam", "epf",
    "esiee", "efrei", "ece", "x ", "esilv", "ipsa", "isep", "sigma", "oniris", "vetagro", "veto", "cy tech", "ensam", "navale",
    "saint cyr", "air", "supoptique", "iogs", "phelma", "ensimag", "seatech", "ingenieur", "grenoble inp", "toulouse inp",
)  # fmt: skip


def est_nom_d_ecole(nom: str) -> bool:
    """Dire si nom contient un mot qui signe une ecole d'ingenieurs (« Centrale Nantes », « ENSTA Paris », « X »)."""
    n = " " + normaliser(nom) + " "
    return any(" " + m in n for m in MOTS_ECOLES)


# Erreurs d'un telechargement a traiter comme « page illisible ». http.client.HTTPException : un lien avec une espace
# (« …formations& page=3 ») a arrete la construction de la base de liens au 141e lycee.
ERREURS_RESEAU = (urllib.error.URLError, ValueError, TimeoutError, OSError, http.client.HTTPException)


def adresse_propre(base: str, href: str) -> str:
    """Rendre l'adresse absolue d'un lien, espaces et caracteres non permis encodes, sans fragment."""
    url = urllib.parse.urljoin(base, html.unescape(href).strip()).split("#")[0]
    return urllib.parse.quote(url, safe=":/?&=%+,;@~!$'()*[]")


class Introuvable(Exception):
    """Aucune page de resultats exploitable n'a ete trouvee pour cette prepa."""


def normaliser(texte: str) -> str:
    """Rendre texte en minuscules, sans accents ni ponctuation, espaces simples."""
    sans_accents = "".join(c for c in unicodedata.normalize("NFD", texte) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", sans_accents.lower()).strip()


def est_ecole(nom: str) -> bool:
    """Dire si nom ressemble a une ecole et pas a un total, un titre ou une ligne de synthese."""
    n = normaliser(nom)
    # « 31 integres sur 33 (94 %) en BCPST (+ 11 doublants) » donnait l'ecole « en BCPST (+ » : parentheses et
    # « en … » viennent des lignes de synthese, jamais d'un nom d'ecole.
    synthese = any(c in nom for c in "(+") or n.startswith("en ")
    return len(n) >= 2 and not synthese and n not in NOMS_EXCLUS and not any(m in n for m in MOTS_EXCLUS)


def _sections(texte: str) -> list[tuple[str | None, list[str]]]:
    """Rendre [(filiere ou None, lignes)] : le texte decoupe aux titres « Filiere MP », « Filiere PC »…"""
    sections, courante = [(None, [])], None
    for ligne in texte.splitlines():
        m = SECTION.match(ligne)
        if m:
            courante = m.group(1).upper()
            sections.append((courante, []))
        else:
            sections[-1][1].append(ligne)
    return [s for s in sections if s[1]]


def _lignes_retenues(texte: str, filiere: str | None) -> list[str]:
    """Rendre les lignes des sections qui suivent la prepa filiere (toutes si None, ou sans titre de section)."""
    sections = _sections(texte)
    suites = SUITES.get(filiere, [])
    titrees = [s for s in sections if s[0] is not None]
    retenues = [s for s in titrees if filiere is None or s[0] in suites] if titrees else sections
    return [ligne for _, lignes in retenues for ligne in lignes]


def _ajouter(totaux: dict, nom: str, n: int) -> None:
    entree = totaux.setdefault(normaliser(nom), {"ecole": nom, "integres": 0})
    entree["integres"] += n


def _par_couples(lignes: list[str]) -> dict:
    """Format « ecole effectif » par ligne (« Centrale Nantes 4 »)."""
    totaux: dict[str, dict] = {}
    for ligne in lignes:
        for brut, nombre in COUPLE.findall(ligne):
            nom, n = re.sub(r"\s+", " ", brut).strip(PONCTUATION_BORD), int(nombre)
            if est_ecole(nom) and 0 < n <= EFFECTIF_MAX:
                _ajouter(totaux, nom, n)
    return totaux


def _par_liste_nominative(lignes: list[str]) -> dict:
    """Format « un eleve par ligne » (« Matteo Arts et Metiers », « 4 Pierre IMT ENTPE Lyon ») : on compte les eleves.

    Le rang eventuel et le prenom (premier mot qui n'est pas un nom d'ecole) sont retires.
    """
    totaux: dict[str, dict] = {}
    for ligne in lignes:
        mots = re.sub(r"^\s*\d{1,3}\s+", "", ligne).split()
        if len(mots) < 2 or est_nom_d_ecole(mots[0]) or not est_nom_d_ecole(" ".join(mots[1:])):
            continue
        nom = " ".join(mots[1:]).strip(PONCTUATION_BORD)
        if est_ecole(nom) and not COUPLE.search(nom):
            _ajouter(totaux, nom, 1)
    return totaux


def extraire_integrations(texte: str, filiere: str | None) -> list[dict]:
    """Rendre [{ecole, integres}] des sections du texte qui suivent la prepa de 1re annee filiere (toutes si None).

    Deux formats publies : « ecole effectif » par ligne, ou un eleve par ligne ; on garde celui qui reconnait le plus
    d'ecoles. Une meme ecole citee dans plusieurs sections (MP et PSI pour une MPSI) est additionnee. Triees par
    effectif decroissant.
    """
    lignes = _lignes_retenues(texte, filiere)
    candidats = [_par_couples(lignes), _par_liste_nominative(lignes)]
    totaux = max(candidats, key=lambda t: sum(est_nom_d_ecole(e["ecole"]) for e in t.values()))
    return sorted(totaux.values(), key=lambda e: (-e["integres"], e["ecole"]))


def _telecharger(url: str, delai: float = DELAI_S, essais: int = ESSAIS_RESEAU) -> tuple[bytes, str]:
    """Rendre (contenu, type MIME) d'une URL (voir telecharger_suivi)."""
    contenu, mime, _ = telecharger_suivi(url, delai, essais)
    return contenu, mime


def telecharger_suivi(url: str, delai: float = DELAI_S, essais: int = ESSAIS_RESEAU) -> tuple[bytes, str, str]:
    """Rendre (contenu, type MIME, adresse finale apres redirections) d'une URL.

    Reprises exponentielles sur 429, 5xx et coupure reseau.

    Raises:
        urllib.error.URLError: reseau indisponible ou erreur HTTP definitive.
        ValueError: document plus gros que TAILLE_MAX.
    """
    requete = urllib.request.Request(url, headers={"User-Agent": AGENT})
    for essai in range(essais):
        try:
            with urllib.request.urlopen(requete, timeout=delai) as reponse:
                contenu = reponse.read(TAILLE_MAX + 1)
                if len(contenu) > TAILLE_MAX:
                    raise ValueError(f"document trop gros : {url}")
                return contenu, reponse.headers.get_content_type(), reponse.geturl()
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or essai == essais - 1:
                raise
        except urllib.error.URLError:
            if essai == essais - 1:
                raise
        time.sleep(2**essai)
    raise AssertionError("inatteignable")


def texte_html(contenu: bytes) -> str:
    """Rendre le texte d'une page HTML, une ligne par bloc."""
    s = contenu.decode("utf-8", errors="replace")
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", s, flags=re.DOTALL | re.IGNORECASE)
    s = re.sub(r"<(br|/p|/tr|/li|/h\d|/div|/td)[^>]*>", "\n", s, flags=re.IGNORECASE)
    s = html.unescape(re.sub(r"<[^>]+>", " ", s))
    return "\n".join(re.sub(r"[ \t]+", " ", ligne).strip() for ligne in s.splitlines() if ligne.strip())


PDFKIT = 'function run(a){ObjC.import("PDFKit");const d=$.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(a[0]));return d?d.string.js:"";}'


def texte_pdf(contenu: bytes) -> str | None:
    """Rendre le texte d'un PDF, None si aucun lecteur n'est disponible (ni PDFKit de macOS, ni pdftotext)."""
    with tempfile.TemporaryDirectory() as dossier:
        chemin = Path(dossier) / "resultats.pdf"
        chemin.write_bytes(contenu)
        if shutil.which("osascript"):
            commande = ["osascript", "-l", "JavaScript", "-e", PDFKIT, str(chemin)]
        elif shutil.which("pdftotext"):
            commande = ["pdftotext", "-layout", str(chemin), "-"]
        else:
            return None
        sortie = subprocess.run(commande, capture_output=True, text=True, timeout=DELAI_S, check=False)
        return sortie.stdout if sortie.returncode == 0 else None


def liens_resultats(page: bytes, base: str) -> list[tuple[int, str]]:
    """Rendre [(annee, url)] des documents de resultats lies depuis une page, le plus recent d'abord.

    L'annee est lue dans le nom du fichier et le texte du lien (« integrations-2025.pdf ») ; 0 si aucune. Pas dans
    les dossiers : « /uploads/2026/01/integrations-2025.pdf » est l'annee de mise en ligne, pas celle du concours.
    """
    trouves = []
    for href, libelle in re.findall(rb'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', page, flags=re.DOTALL):
        url = adresse_propre(base, href.decode("utf-8", errors="replace"))
        texte = normaliser(
            urllib.parse.unquote(url) + " " + re.sub(r"<[^>]+>", " ", libelle.decode("utf-8", "replace"))
        )
        if not any(m in texte for m in MOTS_LIEN) or not re.search(
            r"\.(pdf|html?|php)$|/$", url.split("?")[0], re.IGNORECASE
        ):
            continue
        fichier = urllib.parse.unquote(urllib.parse.urlparse(url).path.rstrip("/").rsplit("/", 1)[-1])
        libelle_texte = re.sub(r"<[^>]+>", " ", libelle.decode("utf-8", "replace"))
        annees = [int(a) for a in re.findall(r"20[1-3]\d", fichier + " " + libelle_texte)]
        trouves.append((max(annees, default=0), url))
    return sorted(set(trouves), key=lambda x: -x[0])


def _texte_document(url: str) -> tuple[str | None, bytes, str]:
    """Rendre (texte ou None si PDF illisible, contenu brut, type MIME) d'un document."""
    contenu, mime = _telecharger(url)
    if mime == "application/pdf" or contenu[:5] == b"%PDF-":
        return texte_pdf(contenu), contenu, "application/pdf"
    return texte_html(contenu), contenu, mime


def est_adresse_autorisee(url: str) -> bool:
    """Dire si url est une adresse web publique qu'on accepte de lire (http(s), hors domaines exclus)."""
    parties = urllib.parse.urlparse(url)
    hote = parties.hostname or ""
    locale = (
        hote in ("localhost", "127.0.0.1", "::1")
        or hote.endswith(".local")
        or re.fullmatch(r"(10|192\.168|172\.(1[6-9]|2\d|3[01]))\..*", hote)
    )
    return (
        parties.scheme in ("http", "https")
        and bool(hote)
        and not locale
        and not any(d in hote for d in DOMAINES_EXCLUS)
    )


def extraire_depuis_adresse(url: str, filiere: str, journal=print) -> dict:
    """Rendre {ecoles, source, annee, consultees} d'apres la page ou le document de resultats donne par l'utilisateur.

    Pour une page web, essaie d'abord les deux documents de resultats les plus recents qu'elle lie (souvent des
    PDF), puis la page elle-meme. S'arrete au premier document qui donne des ecoles.

    Raises:
        ValueError: adresse refusee (non web, reseau local, ou domaine exclu).
        Introuvable: aucun document n'a donne d'ecole.
        urllib.error.URLError: adresse injoignable.
    """
    if not est_adresse_autorisee(url):
        raise ValueError("adresse refusee : il faut une page web publique (le palmares de L'Etudiant est exclu)")
    texte, brut, mime = _texte_document(url)
    liees = (
        [u for _, u in liens_resultats(brut, url) if est_adresse_autorisee(u)][:2] if mime != "application/pdf" else []
    )
    consultees, illisibles = [], 0
    for cible in [*liees, url]:
        texte_cible = texte
        if cible != url:
            try:
                texte_cible, _, _ = _texte_document(cible)
            except ERREURS_RESEAU as exc:
                journal(f"{cible} : {exc}")
                continue
        consultees.append(cible)
        if texte_cible is None:
            illisibles += 1
            continue
        ecoles = extraire_integrations(texte_cible, filiere)
        if ecoles:
            # Nom du fichier et debut du texte (« Concours 2025 ») : pas le dossier, souvent l'annee de mise en ligne.
            debut = urllib.parse.unquote(urllib.parse.urlparse(cible).path.rsplit("/", 1)[-1]) + " " + texte_cible[:400]
            annees = [int(a) for a in re.findall(r"20[1-3]\d", debut)]
            return {"ecoles": ecoles, "source": cible, "annee": max(annees, default=None), "consultees": consultees}
    detail = f" ({illisibles} PDF illisibles : ni PDFKit ni pdftotext)" if illisibles else ""
    raise Introuvable(f"aucune ecole reconnue dans {len(consultees)} documents consultes{detail}")
