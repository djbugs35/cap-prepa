"""Tests de scripts/update_data.py (sans réseau)."""

import gzip
import importlib.util
import io
import json
import typing
import urllib.error
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "update_data.py"
_spec = importlib.util.spec_from_file_location("update_data", _SCRIPT)
ud = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ud)


def rec(**kw):
    base = {
        "cod_aff_form": "100",
        "fili": "CPGE",
        "fil_lib_voe_acc": "MPSI",
        "g_ea_lib_vx": "Lycée Chateaubriand",
        "ville_etab": "Rennes",
        "dep": "35",
        "detail_forma": "",
        "contrat_etab": "Public",
        "capa_fin": 48,
        "voe_tot": 2000,
        "taux_acces_ens": 40,
        "acc_tot": 48,
        "nb_cla_pp_internat": 10,
        "nb_voe_pp": 2000,
        "nb_voe_pp_bg": 1000,
        "prop_tot": 400,
        "prop_tot_bg": 300,
        "g_olocalisation_des_formations": {"lat": 48.1, "lon": -1.68},
    }
    base.update(kw)
    return base


def ligne(rows, i=0):
    return dict(zip(ud.FIELDS, rows[i], strict=True))


def test_ligne_complete_avec_historique():
    passee = rec(taux_acces_ens=35)
    r = ligne(ud.build_rows([rec()], [{}, {"100": passee}]))
    assert r["id"] == 100 and r["filiere"] == "MPSI" and r["public"] == 1 and r["admis"] == 48
    assert r["tauxHist"] == [None, 35]
    assert r["tauxGenHist"][1] == ud.taux_acces_generaux(passee)


def test_taux_generaux_corrige_le_taux_de_tous_les_candidats():
    """Le taux officiel compte reorientations et reprises d'etudes : en MPSI, il sous-estimait
    de moitie les chances d'un eleve de terminale generale (Malherbe 2025 : 28 % affiche, ~49 % reel)."""
    malherbe = rec(taux_acces_ens=28, nb_voe_pp=2329, nb_voe_pp_bg=1307, prop_tot=533, prop_tot_bg=519)
    assert ud.taux_acces_generaux(malherbe) == 49
    assert ud.taux_acces_generaux(rec(prop_tot_bg=None)) is None
    assert ud.taux_acces_generaux(rec(taux_acces_ens=90, prop_tot_bg=400, prop_tot=400)) == 100


def test_taux_officiel_texte_ou_reel():
    """La session 2024 publie le taux en texte ("19"), la 2023 en reel (53.0) : le calcul plantait."""
    assert ud.taux_officiel(rec(taux_acces_ens="19")) == 19
    assert ud.taux_officiel(rec(taux_acces_ens=53.0)) == 53
    assert ud.taux_officiel(rec(taux_acces_ens=None)) is None
    assert ud.taux_acces_generaux(rec(taux_acces_ens="40")) == ud.taux_acces_generaux(rec(taux_acces_ens=40))


def test_internat_selon_cartographie_puis_statistiques():
    filles = {"100": "Etablissements avec internat pour filles"}
    mixte = {"100": "Etablissements avec internat pour filles et garçons"}
    assert ud.code_internat(rec(), filles) == ud.INTERNAT_FILLES
    assert ud.code_internat(rec(), mixte) == ud.INTERNAT_MIXTE
    assert ud.code_internat(rec(), {}) == ud.INTERNAT_MIXTE  # candidats classes en internat
    assert ud.code_internat(rec(nb_cla_pp_internat=0), {}) == ud.INTERNAT_SANS
    assert ud.code_internat(rec(fili="Ecole d'Ingénieur"), {}) is None  # non publie pour les ecoles


def test_statistiques_doublettes_maths_pc():
    mpc = ["Mathématiques Spécialité", "Physique-Chimie Spécialité"]
    lignes = [
        {
            "formation": "MPSI",
            "niveau_d_agregation": "2",
            "doublette": mpc,
            "voeux": 90,
            "propositions_d_admissions": 54,
        },
        {
            "formation": "MPSI",
            "niveau_d_agregation": "2",
            "doublette": ["x", "y"],
            "voeux": 10,
            "propositions_d_admissions": 2,
        },
    ]
    assert ud.statistiques_doublettes(lignes) == {"MPSI": {"tauxMathsPC": 60, "tauxTous": 56, "partMathsPC": 90}}


def test_validation_refuse_un_fichier_tronque_ou_incomplet():
    rows = ud.build_rows([rec()])
    with pytest.raises(ValueError, match="minimum"):
        ud.valider(rows, 2)
    rows[0][ud.FIELDS.index("taux")] = None
    with pytest.raises(ValueError, match="taux"):
        ud.valider(rows, 1)


def test_ecriture_atomique(tmp_path):
    cible = tmp_path / "f.json"
    ud.ecrire_atomique(cible, "{}")
    assert cible.read_text() == "{}" and not list(tmp_path.glob("*.tmp"))


def test_reprise_apres_erreur_serveur(monkeypatch):
    appels = []

    class Reponse(io.BytesIO):
        headers: typing.ClassVar[dict] = {}

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    def urlopen(_requete, timeout):
        appels.append(timeout)
        if len(appels) < 3:
            raise urllib.error.HTTPError("u", 503, "indisponible", {}, None)
        return Reponse(b"[1]")

    monkeypatch.setattr(ud.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(ud.time, "sleep", lambda _s: None)
    assert ud.telecharger_json("http://x") == [1]
    assert len(appels) == 3
    monkeypatch.setattr(
        ud.urllib.request,
        "urlopen",
        lambda *_a, **_k: (_ for _ in ()).throw(urllib.error.HTTPError("u", 404, "absent", {}, None)),
    )
    with pytest.raises(urllib.error.HTTPError):
        ud.telecharger_json("http://x")


def test_exclusions():
    cur = [
        rec(cod_aff_form="1", g_olocalisation_des_formations={}),  # sans coordonnées
        rec(cod_aff_form="2", voe_tot=900, g_olocalisation_des_formations={"lat": -21.1, "lon": 55.5}),  # outre-mer
        rec(cod_aff_form="3", fili="Ecole d'Ingénieur", detail_forma="Bac STI2D"),  # bac techno
        rec(cod_aff_form="4"),
    ]
    assert [r[0] for r in ud.build_rows(cur)] == [4]
    assert {r[0] for r in ud.build_rows(cur, metropole=False)} == {2, 4}


def test_doublons_concours_communs_et_rayon():
    a = rec(cod_aff_form="5", fili="Ecole d'Ingénieur", g_ea_lib_vx="Polytech", detail_forma="Geipi")
    b = dict(a, cod_aff_form="6")
    loin = rec(cod_aff_form="7", g_olocalisation_des_formations={"lat": 43.6, "lon": 1.44})
    rows = ud.build_rows([a, b, loin], centre=(48.1, -1.68), rayon=200)
    assert [r[0] for r in rows] == [5]


def test_dist_rennes_nantes():
    assert abs(ud.dist(48.111, -1.68, 47.218, -1.554) - 99.6) < 1


def test_reponse_gzip_decompressee(monkeypatch):
    """Le catalogue repondait en gzip sans qu'on le demande : json.load echouait sur l'octet 0x8b."""

    class Reponse(io.BytesIO):
        headers: typing.ClassVar[dict] = {"Content-Encoding": "gzip"}

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    monkeypatch.setattr(ud.urllib.request, "urlopen", lambda *_a, **_k: Reponse(gzip.compress(b'{"a": 1}')))
    assert ud.telecharger_json("http://x") == {"a": 1}


# ---------- sources locales (data/sources) ----------


def lycee(uai, nom, lat):
    return {"identifiant_de_l_etablissement": uai, "nom_etablissement": nom, "nom_commune": "Rennes", "code_departement": "035",
            "libelle_academie": "Rennes", "latitude": lat, "longitude": -1.67, "statut_public_prive": "Public"}  # fmt: skip


def faux_reseau(monkeypatch, absents=(), modifie="2026-03-09T16:54:47+00:00"):
    """Remplacer exporter et version_distante ; rendre la liste des jeux telecharges, dans l'ordre."""
    appels = []

    def exporter(jeu, _filtre, _champs=None, _api=None):
        if jeu in absents:
            raise urllib.error.HTTPError("u", 404, "absent", {}, None)
        appels.append(jeu)
        if jeu == ud.JEU_CARTOGRAPHIE:
            return [{"gta": "0", "int": ["Internat filles"]}]
        if jeu == ud.JEU_DOUBLETTES:
            return []
        if jeu == ud.JEU_INSERSUP:
            return [
                {
                    "etablissement": "0350097R",
                    "promo": ["2024"],
                    "tx_sortants_en_emploi_sal_fr_18": "80.5",
                    "salaire_q2_18": "2500",
                }
            ]
        if jeu == ud.JEU_LYCEES:
            return [lycee("0350029B", "Lycée Chateaubriand", 48.12), lycee("0350030C", "Lycée Sans Position", None)]
        return [rec(session="2025", cod_aff_form=str(i), g_ea_lib_vx=f"Lycee {i}") for i in range(3)]

    monkeypatch.setattr(ud, "exporter", exporter)
    monkeypatch.setattr(
        ud, "version_distante", lambda jeu, _api=None: {"titre": jeu, "modifie": modifie, "lignesPubliees": 3}
    )
    return appels


def test_mise_a_jour_commence_par_la_session_courante(monkeypatch, tmp_path):
    appels = faux_reseau(monkeypatch)
    assert ud.mettre_a_jour_sources(tmp_path, journal=lambda _m: None) == 2025
    assert appels[:2] == [ud.JEU_COURANT, ud.JEU_COURANT]  # CPGE puis ecoles
    assert "fr-esr-parcoursup_2023" in appels and ud.JEU_CARTOGRAPHIE in appels
    assert sorted(p.stem for p in tmp_path.glob("*.json")) == [
        "doublettes", "insersup", "internats", "lycees", "parcoursup", "parcoursup-n1", "parcoursup-n2"
    ]  # fmt: skip


def test_mise_a_jour_d_une_seule_source(monkeypatch, tmp_path):
    faux_reseau(monkeypatch)
    ud.mettre_a_jour_sources(tmp_path, journal=lambda _m: None)
    appels = faux_reseau(monkeypatch)
    ud.mettre_a_jour_sources(tmp_path, ["internats"], journal=lambda _m: None)
    assert appels == [ud.JEU_CARTOGRAPHIE]


def test_historique_absent_ignore_mais_source_indispensable_absente_remontee(monkeypatch, tmp_path):
    faux_reseau(monkeypatch, absents={"fr-esr-parcoursup_2023"})
    ud.mettre_a_jour_sources(tmp_path, journal=lambda _m: None)
    assert not (tmp_path / "parcoursup-n2.json").exists()
    faux_reseau(monkeypatch, absents={ud.JEU_CARTOGRAPHIE})
    with pytest.raises(urllib.error.HTTPError):
        ud.mettre_a_jour_sources(tmp_path, journal=lambda _m: None)


def test_source_d_une_autre_session_ignoree(monkeypatch, tmp_path):
    """Quand le jeu courant passe a la session suivante, l'ancien parcoursup-n1 vient d'un autre jeu : a retelecharger."""
    faux_reseau(monkeypatch)
    ud.mettre_a_jour_sources(tmp_path, journal=lambda _m: None)
    source = next(s for s in ud.definir_sources(2026) if s["cle"] == "parcoursup-n1")
    assert source["jeu"] == "fr-esr-parcoursup_2025"
    assert ud.lire_source(tmp_path, source) is None


def test_etat_compare_version_locale_et_publiee(monkeypatch, tmp_path):
    faux_reseau(monkeypatch)
    vide = ud.etat_sources(tmp_path)
    assert vide["session"] is None and [s["present"] for s in vide["sources"]] == [False]
    ud.mettre_a_jour_sources(tmp_path, journal=lambda _m: None)
    etat = ud.etat_sources(tmp_path, verifier=True)
    assert etat["session"] == 2025 and all(s["aJour"] for s in etat["sources"])
    assert etat["sources"][0]["lignes"] == 6 and etat["sources"][0]["octets"] > 0
    faux_reseau(monkeypatch, modifie="2026-11-01T00:00:00+00:00")
    assert not any(s["aJour"] for s in ud.etat_sources(tmp_path, verifier=True)["sources"])


def test_construction_depuis_les_sources_locales(monkeypatch, tmp_path):
    with pytest.raises(ud.SourceAbsente):
        ud.construire_formations(tmp_path)
    faux_reseau(monkeypatch)
    ud.mettre_a_jour_sources(tmp_path, journal=lambda _m: None)
    monkeypatch.setattr(ud, "MIN_LIGNES_NATIONAL", 1)
    texte, meta = ud.construire_formations(tmp_path)
    assert meta["session"] == 2025 and meta["sessionsHist"] == [2023, 2024] and meta["formations"] == 3
    rows = json.loads(texte)["rows"]
    assert ligne(rows, 0)["internat"] == ud.INTERNAT_FILLES  # cartographie lue depuis internats.json


def test_lycees_construits_depuis_l_annuaire(monkeypatch, tmp_path):
    assert ud.ecrire_lycees(tmp_path, tmp_path / "lycees.json") is False  # rien de telecharge : rien d'ecrit
    faux_reseau(monkeypatch)
    ud.mettre_a_jour_sources(tmp_path, journal=lambda _m: None)
    assert ud.ecrire_lycees(tmp_path, tmp_path / "lycees.json")
    donnees = json.loads((tmp_path / "lycees.json").read_text())
    assert donnees["meta"]["fields"] == ud.FIELDS_LYCEES
    assert donnees["rows"] == [
        ["0350029B", "Lycée Chateaubriand", "Rennes", "035", "Rennes", 48.12, -1.67, 1]
    ]  # sans position : ecarte


def test_academie_de_la_formation_dans_la_ligne():
    assert ligne(ud.build_rows([rec(acad_mies="Rennes")]))["academie"] == "Rennes"


def test_insertion_derniere_promotion_diffusee_par_indicateur():
    lignes = [
        {"etablissement": "A", "promo": ["2022"], "tx_sortants_en_emploi_sal_fr_18": "70.4", "salaire_q2_18": "2400"},
        {"etablissement": "A", "promo": ["2024"], "tx_sortants_en_emploi_sal_fr_18": "81.6", "salaire_q2_18": "nd"},
        {
            "etablissement": "B",
            "promo": ["2019", "2020"],
            "tx_sortants_en_emploi_sal_fr_18": "nd",
            "salaire_q2_18": "nd",
        },
    ]
    # Le salaire de 2024 n'est pas diffuse : on garde celui de 2022 plutot que rien.
    assert ud.indicateurs_insertion(lignes) == {"A": {"emploi": 82, "salaire": 2400, "promo": "2024"}}


def test_insertion_par_uai_strict_et_ecoles_seulement():
    insertion = {"0350097R": {"emploi": 80, "salaire": 2500, "promo": "2024"}}
    ecole = rec(fili="Ecole d'Ingénieur", fil_lib_voe_acc="Formation d'ingénieur Bac + 5", cod_uai="0350097R")
    assert ligne(ud.build_rows([ecole], insertion=insertion))["insSalaire"] == 2500
    autre_campus = rec(fili="Ecole d'Ingénieur", fil_lib_voe_acc="Formation d'ingénieur Bac + 5", cod_uai="0359999Z")
    assert ligne(ud.build_rows([autre_campus], insertion=insertion))["insEmploi"] is None
    assert (
        ligne(ud.build_rows([rec(cod_uai="0350097R")], insertion=insertion))["insEmploi"] is None
    )  # CPGE : sans objet
