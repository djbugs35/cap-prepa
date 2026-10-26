"""Tests de scripts/liens.py : exploration des sites de lycees et base de liens (sans reseau)."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import liens

SITE = {
    "http://lycee.example": b'<a href="/le-lycee/">Le lycee</a><a href="/cpge/">Les CPGE</a><a href="https://ailleurs.example/r">x</a>',
    "http://lycee.example/cpge/": b'<a href="/cpge/resultats-concours/">Resultats aux concours</a><a href="/photo.jpg">photo</a>',
    "http://lycee.example/cpge/resultats-concours/": (
        b'<a href="/uploads/2026/01/integrations-2025.pdf">Session 2025</a><a href="/uploads/2024/12/integrations-2024.pdf">2024</a>'
    ),
    "http://lycee.example/le-lycee/": b"<p>Histoire</p>",
}


def faux_site(
    monkeypatch,
    site=SITE,
    redirections=None,
    resultats="Centrale Nantes 4\nINSA Lyon 2\nMines Paris 1\nENSTA Paris 2\nISAE Supaero 1\nTelecom Paris 3\nPolytech Nantes 2\n",
):
    redirections = redirections or {}
    monkeypatch.setattr(liens.db, "_texte_document", lambda _u: (resultats, b"", "application/pdf"))
    lues = []

    def telecharger(url, **_k):
        lues.append(url)
        cible = redirections.get(url, url)
        if cible not in site:
            raise liens.urllib.error.URLError("absent")
        return site[cible], "text/html", cible

    monkeypatch.setattr(liens.db, "telecharger_suivi", telecharger)
    monkeypatch.setattr(liens, "_robots", lambda _racine: None)
    return lues


def test_liens_internes_utiles_seulement():
    suivis = liens.liens_a_suivre(SITE["http://lycee.example"], "http://lycee.example", "lycee.example")
    assert suivis == [(1, "http://lycee.example/cpge/")]  # page externe et « Le lycee » ecartees


def test_exploration_va_droit_aux_resultats(monkeypatch):
    lues = faux_site(monkeypatch)
    r = liens.explorer_site("http://lycee.example", journal=lambda _m: None, pause=0)
    assert r["statut"] == "trouve" and r["lien"] == "http://lycee.example/cpge/resultats-concours/"
    assert r["annee"] == 2025 and r["document"].endswith("integrations-2025.pdf")  # annee du fichier, pas du dossier
    assert "http://lycee.example/le-lycee/" not in lues


def test_site_sans_resultats_ou_injoignable(monkeypatch):
    faux_site(monkeypatch, {"http://vide.example": b"<p>Rien</p>"})
    assert liens.explorer_site("vide.example", journal=lambda _m: None, pause=0)["statut"] == "introuvable"
    assert liens.explorer_site("http://mort.example", journal=lambda _m: None, pause=0)["statut"] == "site-injoignable"


def test_base_completee_sans_reexplorer(monkeypatch, tmp_path):
    lycees = {
        "0440021J": {
            "lycee": "Lycee A",
            "ville": "Nantes",
            "site": "http://lycee.example",
            "prepas": [1],
            "filieres": ["MPSI"],
        },
        "0350001A": {"lycee": "Lycee B", "ville": "Rennes", "site": None, "prepas": [2], "filieres": ["PCSI"]},
    }
    monkeypatch.setattr(liens, "lycees_a_prepa", lambda _d: lycees)
    explores = []
    monkeypatch.setattr(
        liens, "explorer_site", lambda site, *_a: explores.append(site) or {"statut": "trouve", "lien": site + "/r/"}
    )
    chemin = tmp_path / "liens.json"
    base = liens.completer_base(tmp_path, chemin=chemin, journal=lambda _m: None)
    assert base["lycees"]["0350001A"]["statut"] == "sans-site" and explores == ["http://lycee.example"]
    liens.completer_base(tmp_path, chemin=chemin, journal=lambda _m: None)
    assert explores == ["http://lycee.example"]  # deja dans la base : pas re-explore
    liens.completer_base(tmp_path, ["0440021J"], refaire=True, chemin=chemin, journal=lambda _m: None)
    assert len(explores) == 2
    assert json.loads(chemin.read_text())["lycees"]["0440021J"]["prepas"] == [1]


def test_site_qui_redirige_vers_une_autre_adresse(monkeypatch):
    """livet.e-lyco.fr redirige vers livet.paysdelaloire.e-lyco.fr : tous ses liens etaient ecartes comme externes."""
    site = {f"http://www.nouveau.example{k.removeprefix('http://lycee.example')}": v.replace(b"lycee.example", b"nouveau.example")
            for k, v in SITE.items()}  # fmt: skip
    faux_site(monkeypatch, site, {"http://ancien.example": "http://www.nouveau.example"})
    r = liens.explorer_site("http://ancien.example", journal=lambda _m: None, pause=0)
    assert r["statut"] == "trouve" and r["lien"] == "http://www.nouveau.example/cpge/resultats-concours/"
    assert liens.meme_site("www.nouveau.example", "nouveau.example")


def test_priorite_plan_prefere_les_pages_courtes_aux_actualites():
    """Les actualites « …-lors-des-ecrits-aux-concours-28498 » passaient avant « les-resultats-de-sessions »."""
    base = "https://lycee.example/"
    vraie = liens.priorite_plan(base + "les-resultats-de-sessions/")
    actualite = liens.priorite_plan(
        base + "infos/changement-de-regime-pour-les-etudiants-lors-des-ecrits-aux-concours-28498/"
    )
    admissibilites = liens.priorite_plan(base + "non-categorise/cpge-admissibilites-session-2026/")
    assert vraie > admissibilites and actualite <= 0


def test_page_sans_ecoles_lisibles_ecartee(monkeypatch):
    """« Journees d'integration des eleves de seconde » passait pour une page de resultats : rien n'en sort."""
    faux_site(monkeypatch, resultats="Accueil des secondes, jeux et pique-nique.")
    assert liens.explorer_site("http://lycee.example", journal=lambda _m: None, pause=0)["statut"] == "introuvable"


def test_robots_lus_avec_delai(monkeypatch):
    """RobotFileParser.read n'a pas de delai : un site muet bloquait la construction de la base indefiniment."""
    appels = []

    def telecharger(url, **k):
        appels.append((url, k.get("delai")))
        return b"User-agent: *\nDisallow: /prive/\n", "text/plain", url

    monkeypatch.setattr(liens.db, "telecharger_suivi", telecharger)
    regles = liens._robots("https://lycee.example/")
    assert appels == [("https://lycee.example/robots.txt", liens.DELAI_S)]
    assert not regles.can_fetch(liens.db.AGENT, "https://lycee.example/prive/x") and regles.can_fetch(
        liens.db.AGENT, "https://lycee.example/cpge/"
    )


def test_tournoi_de_foot_ou_olympiades_ecartes(monkeypatch):
    """Scores sportifs et palmares d'olympiades passaient pour des resultats : il faut des noms d'ecoles."""
    faux_site(monkeypatch, resultats="Equipe A 3\nEquipe B 2\nClasse de seconde 4\nPrix du jury 1\n")
    assert liens.explorer_site("http://lycee.example", journal=lambda _m: None, pause=0)["statut"] == "introuvable"


def test_noms_d_ecoles_reconnus():
    for nom in (
        "Centrale Nantes",
        "ENSTA Paris",
        "X Polytechnique",
        "Arts et Métiers",
        "INSA Lyon",
        "Grenoble INP-ENSIMAG",
    ):
        assert liens.db.est_nom_d_ecole(nom), nom
    for nom in ("Equipe A", "Classe de seconde", "Prix du jury", "Mention TB"):
        assert not liens.db.est_nom_d_ecole(nom), nom


def test_lien_avec_espace_encode():
    """« index.php?section=formations& page=3 » levait http.client.InvalidURL et arretait la construction de la base."""
    assert liens.db.adresse_propre("https://l.example/a/", "index.php?section=formations& page=3#haut") == (
        "https://l.example/a/index.php?section=formations&%20page=3"
    )


def test_adresses_exclues():
    for url in ("https://l.example/resultats-du-baccalaureat-bravo/", "https://l.example/concours-deloquence/",
                "https://l.example/2025/journee-dintegration/", "https://l.example/?TYPE_PAGE=DONNEES_PERSONNELLES"):  # fmt: skip
        assert liens.est_adresse_exclue(url), url
    assert not liens.est_adresse_exclue("https://l.example/cpge/resultats-concours/")
    assert not liens.est_adresse_exclue(
        "https://l.example/filieres-post-bac/mpsi-mp/resultats-de-la-promo-10-concours/"
    )
