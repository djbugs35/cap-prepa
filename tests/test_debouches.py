"""Tests de scripts/debouches.py : extraction des ecoles integrees (sans reseau)."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import debouches as db

# Extrait du PDF « integrations-2025.pdf » du lycee Clemenceau (Nantes), tel que le lit PDFKit.
RESULTATS = """Integrations dans les grandes ecoles - Concours 2025
LYCEE CLEMENCEAU - NANTES
27 integres sur 31 etudiants (84%) en MP (+ 5 doublants)
Filière MP
X-ENS
X Polytechnique 3
Centrale
28%
Ecoles Integres Mines-Ponts 8 Mines Telecom 11 Mines-
CCINP 6 Ponts
Autres 8 Centrale Supélec 4
Centrale Nantes 4
IMT Nord Europe 1 Grenoble INP-ENSIMAG 1
31 intégrés sur 33 étudiants (94%) en PSI (+ 11 doublants)
Filière PSI
Centrale Nantes 2
Arts et Métiers 5
Filière PC
ENSC 7
Filière BCPST
Agro ParisTech 10
"""


def test_ecoles_des_filieres_qui_suivent_la_prepa_seulement():
    ecoles = {e["ecole"]: e["integres"] for e in db.extraire_integrations(RESULTATS, "MPSI")}
    assert ecoles == {
        "X Polytechnique": 3, "Centrale Supélec": 4, "Centrale Nantes": 6, "IMT Nord Europe": 1,
        "Grenoble INP-ENSIMAG": 1, "Arts et Métiers": 5,
    }  # fmt: skip
    assert [e["ecole"] for e in db.extraire_integrations(RESULTATS, "BCPST")] == ["Agro ParisTech"]


def test_totaux_de_banques_et_lignes_de_synthese_ecartes():
    """« 31 integres sur 33 (94%) en PSI (+ 11 doublants) » donnait l'ecole « en PSI (+ » avec 11 integres."""
    noms = [e["ecole"] for e in db.extraire_integrations(RESULTATS, "MPSI")]
    assert not any(n.startswith("en ") or "(" in n for n in noms)
    assert not {"Mines Telecom", "CCINP", "Autres", "Mines-Ponts"} & set(noms)


def test_texte_sans_section_lu_en_entier_et_nombres_aberrants_ignores():
    ecoles = db.extraire_integrations("Centrale Lyon 4\nINSA Toulouse 2\nCode postal 31400\n", "PCSI")
    assert ecoles == [{"ecole": "Centrale Lyon", "integres": 4}, {"ecole": "INSA Toulouse", "integres": 2}]


def test_liens_vers_les_resultats_les_plus_recents_d_abord():
    page = (
        b'<a href="/uploads/2024/12/synthese-integrations-2024.pdf">Session 2024</a>'
        b'<a href="/uploads/2026/01/integrations-2025.pdf">Session 2025</a>'
        b'<a href="/contact/">Contact</a>'
    )
    liens = db.liens_resultats(page, "https://lycee.example/resultats/")
    assert [u for _, u in liens] == [
        "https://lycee.example/uploads/2026/01/integrations-2025.pdf",
        "https://lycee.example/uploads/2024/12/synthese-integrations-2024.pdf",
    ]


def test_adresses_refusees():
    assert db.est_adresse_autorisee("https://lycee.example/resultats.pdf")
    for url in ("file:///etc/passwd", "http://localhost:8765/api", "http://192.168.1.1/", "https://www.letudiant.fr/x"):
        assert not db.est_adresse_autorisee(url), url


def test_page_qui_lie_un_pdf(monkeypatch):
    pages = {
        "https://lycee.example/resultats/": (b'<a href="/r/integrations-2025.pdf">2025</a>', "text/html"),
        "https://lycee.example/r/integrations-2025.pdf": (b"%PDF-1.7 ...", "application/pdf"),
    }
    monkeypatch.setattr(db, "_telecharger", lambda url: pages[url])
    monkeypatch.setattr(db, "texte_pdf", lambda _octets: RESULTATS)
    r = db.extraire_depuis_adresse("https://lycee.example/resultats/", "PCSI")
    assert r["source"].endswith("integrations-2025.pdf") and r["annee"] == 2025
    assert r["ecoles"][0] == {"ecole": "ENSC", "integres": 7}


def test_rien_de_lisible(monkeypatch):
    monkeypatch.setattr(db, "_telecharger", lambda _url: (b"%PDF-1.7", "application/pdf"))
    monkeypatch.setattr(db, "texte_pdf", lambda _octets: None)
    with pytest.raises(db.Introuvable, match="PDF illisibles"):
        db.extraire_depuis_adresse("https://lycee.example/r.pdf", "MPSI")
    with pytest.raises(ValueError, match="adresse refusee"):
        db.extraire_depuis_adresse("https://www.letudiant.fr/palmares", "MPSI")
