@echo off
rem Lance Cap Prepa en local sous Windows : double-clic dans l'Explorateur, ou lancer.bat depuis une invite.
rem Options transmises au serveur, par exemple : lancer.bat --port 8800
cd /d "%~dp0"

set PY=
where py >nul 2>&1 && set PY=py -3
if not defined PY where python >nul 2>&1 && set PY=python
if not defined PY (
  echo Python 3 est introuvable. Lancez d'abord installer.bat.
  pause
  exit /b 1
)

%PY% scripts\serveur.py %*
if errorlevel 1 pause
