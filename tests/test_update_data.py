"""Tests de scripts/update_data.py (sans réseau)."""
import importlib.util
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "update_data.py"
_spec = importlib.util.spec_from_file_location("update_data", _SCRIPT)
ud = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ud)


def rec(**kw):
    base = {"cod_aff_form": "100", "fili": "CPGE", "fil_lib_voe_acc": "MPSI", "g_ea_lib_vx": "Lycée Chateaubriand",
            "ville_etab": "Rennes", "dep": "35", "detail_forma": "", "contrat_etab": "Public", "capa_fin": 48,
            "voe_tot": 2000, "taux_acces_ens": 40, "acc_tot": 48, "nb_voe_pp_internat": 10,
            "g_olocalisation_des_formations": {"lat": 48.1, "lon": -1.68}}
    base.update(kw)
    return base


def test_ligne_complete_et_ordre_des_champs():
    rows = ud.build_rows([rec()], [{"cod_aff_form": "100", "taux_acces_ens": 35}])
    assert len(rows) == 1
    r = dict(zip(ud.FIELDS, rows[0], strict=True))
    assert r["id"] == 100 and r["filiere"] == "MPSI" and r["public"] == 1 and r["internat"] == 1
    assert r["tauxPrev"] == 35 and r["admis"] == 48


def test_exclusions():
    cur = [
        rec(cod_aff_form="1", g_olocalisation_des_formations={}),                       # sans coordonnées
        rec(cod_aff_form="2", voe_tot=900, g_olocalisation_des_formations={"lat": -21.1, "lon": 55.5}),  # outre-mer
        rec(cod_aff_form="3", fili="Ecole d'Ingénieur", detail_forma="Bac STI2D"),      # bac techno
        rec(cod_aff_form="4"),
    ]
    assert [r[0] for r in ud.build_rows(cur, [])] == [4]
    assert {r[0] for r in ud.build_rows(cur, [], metropole=False)} == {2, 4}


def test_doublons_concours_communs_et_rayon():
    a = rec(cod_aff_form="5", fili="Ecole d'Ingénieur", g_ea_lib_vx="Polytech", detail_forma="Geipi")
    b = dict(a, cod_aff_form="6")
    loin = rec(cod_aff_form="7", g_olocalisation_des_formations={"lat": 43.6, "lon": 1.44})
    rows = ud.build_rows([a, b, loin], [], centre=(48.1, -1.68), rayon=200)
    assert [r[0] for r in rows] == [5]


def test_dist_rennes_nantes():
    assert abs(ud.dist(48.111, -1.68, 47.218, -1.554) - 99.6) < 1
