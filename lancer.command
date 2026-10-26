#!/bin/sh
# Lance Cap Prépa en local : double-clic dans le Finder (macOS) ou ./lancer.command dans un terminal.
# Options transmises au serveur, par exemple : ./lancer.command --port 8800
cd "$(dirname "$0")" && exec python3 scripts/serveur.py "$@"
