"""Serveur local de Cap Prepa : sert le site et gere les donnees (onglet « Donnees »).

N'ecoute que sur 127.0.0.1 : rien n'est expose au reseau local. Bibliotheque standard uniquement.

API :
    GET  /api/donnees               etat local des sources et de la derniere mise a jour
    GET  /api/donnees?verifier=1    idem, avec la version publiee de chaque source (reseau)
    POST /api/donnees/mettre-a-jour {"cles": [...] ou null} : telecharge puis reconstruit data/formations.json

Exemple :
    python3 scripts/serveur.py                 # ouvre http://127.0.0.1:8765 dans le navigateur
"""

import argparse
import datetime as dt
import json
import sys
import threading
import urllib.error
import urllib.parse
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import update_data as ud

RACINE = Path(__file__).resolve().parent.parent
PORT_PAR_DEFAUT = 8765
HOTE = "127.0.0.1"
LIGNES_JOURNAL_MAX = 200


class MiseAJour:
    """Une mise a jour des sources a la fois, en arriere-plan, avec son journal."""

    def __init__(self, dossier: Path, sortie: Path):
        self.dossier, self.sortie = dossier, sortie
        self._verrou = threading.Lock()
        self._etat = {"enCours": False, "debut": None, "fin": None, "erreur": None, "journal": []}

    def etat(self) -> dict:
        """Rendre une copie de l'etat de la derniere mise a jour."""
        with self._verrou:
            return {**self._etat, "journal": list(self._etat["journal"])}

    def _noter(self, message: str) -> None:
        with self._verrou:
            self._etat["journal"] = [*self._etat["journal"], message][-LIGNES_JOURNAL_MAX:]

    def lancer(self, cles: list[str] | None) -> bool:
        """Demarrer la mise a jour ; rendre False si une autre est deja en cours."""
        with self._verrou:
            if self._etat["enCours"]:
                return False
            debut = dt.datetime.now(dt.UTC).isoformat(timespec="seconds")
            self._etat = {"enCours": True, "debut": debut, "fin": None, "erreur": None, "journal": []}
        threading.Thread(target=self._executer, args=(cles,), daemon=True).start()
        return True

    def _executer(self, cles: list[str] | None) -> None:
        erreur = None
        try:
            ud.mettre_a_jour_sources(self.dossier, cles, journal=self._noter)
            self._noter("Reconstruction de data/formations.json…")
            texte, meta = ud.construire_formations(self.dossier)
            ud.ecrire_atomique(self.sortie, texte)
            self._noter(
                f"{meta['formations']} formations, session {meta['session']}, historique {meta['sessionsHist']}."
            )
        except (urllib.error.URLError, ud.SourceAbsente, ValueError, OSError) as exc:
            erreur = f"{type(exc).__name__} : {exc}"
            self._noter("Échec : " + erreur)
        with self._verrou:
            fin = dt.datetime.now(dt.UTC).isoformat(timespec="seconds")
            self._etat |= {"enCours": False, "fin": fin, "erreur": erreur}


def traiter_api(methode: str, chemin: str, corps: bytes, mise_a_jour: MiseAJour) -> tuple[int, dict]:
    """Rendre (code HTTP, reponse JSON) d'une requete /api/…, sans toucher au reseau sauf verification demandee."""
    url = urllib.parse.urlsplit(chemin)
    if methode == "GET" and url.path == "/api/donnees":
        verifier = urllib.parse.parse_qs(url.query).get("verifier") == ["1"]
        try:
            etat = ud.etat_sources(mise_a_jour.dossier, verifier)
        except urllib.error.URLError as exc:
            etat = ud.etat_sources(mise_a_jour.dossier) | {
                "erreurVerification": f"catalogue injoignable ({exc.reason})"
            }
        return HTTPStatus.OK, etat | {"miseAJour": mise_a_jour.etat()}
    if methode == "POST" and url.path == "/api/donnees/mettre-a-jour":
        try:
            cles = json.loads(corps or b"{}").get("cles")
        except (json.JSONDecodeError, AttributeError):
            return HTTPStatus.BAD_REQUEST, {"erreur": 'corps JSON attendu : {"cles": [...] ou null}'}
        if cles is not None and not (isinstance(cles, list) and all(isinstance(c, str) for c in cles)):
            return HTTPStatus.BAD_REQUEST, {"erreur": "cles : liste de noms de sources, ou null pour toutes"}
        if not mise_a_jour.lancer(cles):
            return HTTPStatus.CONFLICT, {"erreur": "une mise a jour est deja en cours"}
        return HTTPStatus.ACCEPTED, {"miseAJour": mise_a_jour.etat()}
    return HTTPStatus.NOT_FOUND, {"erreur": "route inconnue"}


def est_requete_locale(entetes, port: int) -> bool:
    """Dire si la requete vient de la page servie ici.

    Host bloque le DNS rebinding ; Origin, envoye par le navigateur sur un POST, bloque un autre site
    qui tenterait de declencher une mise a jour sur ce poste.
    """
    hotes = {f"{HOTE}:{port}", f"localhost:{port}"}
    origine = entetes.get("Origin")
    return entetes.get("Host") in hotes and (origine is None or origine in {"http://" + h for h in hotes})


def creer_gestionnaire(mise_a_jour: MiseAJour, port: int):
    """Rendre la classe de gestionnaire HTTP liee a cette mise a jour et a ce port."""

    class Gestionnaire(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(RACINE), **kwargs)

        def _repondre_json(self, code: int, donnees: dict) -> None:
            corps = json.dumps(donnees, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(corps)))
            self.end_headers()
            self.wfile.write(corps)

        def _api(self, methode: str) -> None:
            if not est_requete_locale(self.headers, port):
                self._repondre_json(HTTPStatus.FORBIDDEN, {"erreur": "requete refusee : origine non locale"})
                return
            if methode == "POST" and self.headers.get_content_type() != "application/json":
                self._repondre_json(
                    HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"erreur": "Content-Type application/json attendu"}
                )
                return
            corps = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            self._repondre_json(*traiter_api(methode, self.path, corps, mise_a_jour))

        def do_GET(self):
            if self.path.startswith("/api/"):
                self._api("GET")
            elif any(p.startswith(".") for p in urllib.parse.urlsplit(self.path).path.split("/")):
                self.send_error(HTTPStatus.NOT_FOUND)  # .git, .github… ne sont pas a servir
            else:
                super().do_GET()

        def do_POST(self):
            self._api("POST")

        def log_message(self, format, *args):
            if self.path.startswith("/api/"):
                super().log_message(format, *args)

    return Gestionnaire


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=PORT_PAR_DEFAUT)
    ap.add_argument("--sans-navigateur", action="store_true", help="ne pas ouvrir le navigateur")
    a = ap.parse_args()
    mise_a_jour = MiseAJour(ud.DOSSIER_SOURCES, ud.SORTIE_PAR_DEFAUT)
    try:
        serveur = ThreadingHTTPServer((HOTE, a.port), creer_gestionnaire(mise_a_jour, a.port))
    except OSError as exc:
        sys.exit(f"Port {a.port} indisponible ({exc.strerror}) : Cap Prepa tourne peut-etre deja, ou essayez --port.")
    adresse = f"http://{HOTE}:{a.port}/"
    print(f"Cap Prepa : {adresse}  (Ctrl+C pour arreter)")
    if not a.sans_navigateur:
        webbrowser.open(adresse)
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        print("\nArret.")
    finally:
        serveur.server_close()


if __name__ == "__main__":
    main()
