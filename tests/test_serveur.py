"""Tests de scripts/serveur.py : API et filtrage des requetes (sans reseau ni socket)."""

import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import serveur
import update_data as ud

PORT = 8765


@pytest.fixture
def mise_a_jour(tmp_path):
    return serveur.MiseAJour(tmp_path / "sources", tmp_path / "formations.json")


def attendre_fin(mise_a_jour, delai=5.0):
    fin = time.monotonic() + delai
    while mise_a_jour.etat()["enCours"] and time.monotonic() < fin:
        time.sleep(0.01)
    return mise_a_jour.etat()


def test_etat_sans_source_telechargee(mise_a_jour):
    code, reponse = serveur.traiter_api("GET", "/api/donnees", b"", mise_a_jour)
    assert code == 200
    assert reponse["session"] is None and reponse["sources"][0]["present"] is False
    assert reponse["miseAJour"]["enCours"] is False


def test_requetes_invalides(mise_a_jour):
    assert serveur.traiter_api("POST", "/api/donnees/mettre-a-jour", b"pas du json", mise_a_jour)[0] == 400
    assert serveur.traiter_api("POST", "/api/donnees/mettre-a-jour", b'{"cles": "tout"}', mise_a_jour)[0] == 400
    assert serveur.traiter_api("GET", "/api/inconnue", b"", mise_a_jour)[0] == 404


def test_mise_a_jour_en_arriere_plan_puis_fichier_reconstruit(monkeypatch, mise_a_jour):
    def telecharger(dossier, _cles, journal):
        journal("ok")
        dossier.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(ud, "mettre_a_jour_sources", telecharger)
    monkeypatch.setattr(
        ud, "construire_formations", lambda _d: ("{}\n", {"formations": 1, "session": 2025, "sessionsHist": []})
    )
    code, _ = serveur.traiter_api("POST", "/api/donnees/mettre-a-jour", b'{"cles": null}', mise_a_jour)
    assert code == 202
    etat = attendre_fin(mise_a_jour)
    assert etat["erreur"] is None and etat["fin"] and "ok" in etat["journal"]
    assert mise_a_jour.sortie.read_text() == "{}\n"


def test_une_seule_mise_a_jour_a_la_fois(monkeypatch, mise_a_jour):
    monkeypatch.setattr(ud, "mettre_a_jour_sources", lambda *_a, **_k: time.sleep(0.3))
    monkeypatch.setattr(
        ud, "construire_formations", lambda _d: ("{}", {"formations": 0, "session": 0, "sessionsHist": []})
    )
    assert serveur.traiter_api("POST", "/api/donnees/mettre-a-jour", b"{}", mise_a_jour)[0] == 202
    assert serveur.traiter_api("POST", "/api/donnees/mettre-a-jour", b"{}", mise_a_jour)[0] == 409
    attendre_fin(mise_a_jour)


def test_echec_reseau_note_dans_l_etat(monkeypatch, mise_a_jour):
    def coupure(*_a, **_k):
        raise ud.urllib.error.URLError("hors ligne")

    monkeypatch.setattr(ud, "mettre_a_jour_sources", coupure)
    serveur.traiter_api("POST", "/api/donnees/mettre-a-jour", b"{}", mise_a_jour)
    etat = attendre_fin(mise_a_jour)
    assert "hors ligne" in etat["erreur"] and not mise_a_jour.sortie.exists()


def test_seules_les_requetes_de_la_page_locale_passent():
    assert serveur.est_requete_locale({"Host": f"127.0.0.1:{PORT}"}, PORT)
    assert serveur.est_requete_locale({"Host": f"localhost:{PORT}", "Origin": f"http://localhost:{PORT}"}, PORT)
    assert not serveur.est_requete_locale({"Host": f"127.0.0.1:{PORT}", "Origin": "https://autre-site.example"}, PORT)
    assert not serveur.est_requete_locale({"Host": f"piege.example:{PORT}"}, PORT)  # DNS rebinding


def test_extraction_des_debouches(monkeypatch, mise_a_jour):
    trouve = {
        "ecoles": [{"ecole": "ENSC", "integres": 7}],
        "source": "https://l.example/r.pdf",
        "annee": 2025,
        "consultees": [],
    }
    monkeypatch.setattr(serveur.deb, "extraire_depuis_adresse", lambda *_a, **_k: trouve)
    corps = b'{"url": "https://l.example/", "filiere": "PCSI"}'
    assert serveur.traiter_api("POST", "/api/debouches/extraire", corps, mise_a_jour) == (200, trouve)
    assert serveur.traiter_api("POST", "/api/debouches/extraire", b'{"url": "x"}', mise_a_jour)[0] == 400


def test_extraction_impossible_expliquee(monkeypatch, mise_a_jour):
    def introuvable(*_a, **_k):
        raise serveur.deb.Introuvable("aucune ecole reconnue")

    monkeypatch.setattr(serveur.deb, "extraire_depuis_adresse", introuvable)
    code, reponse = serveur.traiter_api(
        "POST", "/api/debouches/extraire", b'{"url": "u", "filiere": "MPSI"}', mise_a_jour
    )
    assert code == 422 and "aucune ecole" in reponse["erreur"]


def test_recherche_de_liens(monkeypatch, tmp_path, mise_a_jour):
    recherche = serveur.RechercheLiens(tmp_path, tmp_path / "liens.json")
    vues = []
    monkeypatch.setattr(serveur.liens, "lycees_a_prepa", lambda _d: {"U1": {"prepas": [1, 2]}, "U2": {"prepas": [3]}})
    monkeypatch.setattr(
        serveur.liens,
        "completer_base",
        lambda _d, uais, *_a: vues.append(uais) or {"lycees": {"U1": {"statut": "trouve"}}},
    )
    assert serveur.traiter_api("POST", "/api/liens/chercher", b'{"prepas": [2]}', mise_a_jour, recherche)[0] == 202
    assert attendre_fin(recherche)["erreur"] is None and vues == [["U1"]]  # prepa 2 : lycee U1 seulement
    assert serveur.traiter_api("POST", "/api/liens/chercher", b'{"prepas": "tout"}', mise_a_jour, recherche)[0] == 400
    code, reponse = serveur.traiter_api("GET", "/api/liens", b"", mise_a_jour, recherche)
    assert code == 200 and reponse["base"]["lycees"] == {} and "recherche" in reponse
