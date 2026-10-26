#!/bin/sh
# Installe Cap Prépa en local : vérifie Python, télécharge les données Parcoursup, prépare le lanceur.
# Rien n'est installé hors de ce dossier ; aucune dépendance hors bibliothèque standard de Python.
set -eu
cd "$(dirname "$0")"

PY=$(command -v python3 || true)
if [ -z "$PY" ]; then
  echo "Python 3 est introuvable. Installez Python 3.11 ou plus récent : https://www.python.org/downloads/"
  exit 1
fi
# 3.11 : datetime.UTC, utilisé par scripts/update_data.py.
if ! "$PY" -c 'import sys; sys.exit(sys.version_info < (3, 11))'; then
  echo "Python 3.11 ou plus récent requis (trouvé : $("$PY" --version))."
  exit 1
fi
chmod +x lancer.command

echo "Téléchargement des données Parcoursup (moins d'une minute)…"
if "$PY" scripts/update_data.py; then
  echo "Données à jour."
else
  echo "Téléchargement impossible pour l'instant : l'outil utilisera le fichier fourni."
  echo "Vous pourrez réessayer depuis l'onglet « Données »."
fi

echo
echo "Installation terminée. Pour lancer Cap Prépa : ./lancer.command (ou double-clic dans le Finder)."
