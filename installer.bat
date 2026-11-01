@echo off
rem Installe Cap Prepa en local sous Windows : verifie Python, telecharge les donnees Parcoursup.
rem Rien n'est installe hors de ce dossier ; aucune dependance hors bibliotheque standard de Python.
cd /d "%~dp0"

set PY=
where py >nul 2>&1 && set PY=py -3
if not defined PY where python >nul 2>&1 && set PY=python
if not defined PY (
  echo Python 3 est introuvable. Installez Python 3.11 ou plus recent : https://www.python.org/downloads/
  echo Pendant l'installation, cochez "Add python.exe to PATH".
  pause
  exit /b 1
)

rem 3.11 : datetime.UTC, utilise par scripts\update_data.py.
%PY% -c "import sys; sys.exit(sys.version_info < (3, 11))"
if errorlevel 1 (
  echo Python 3.11 ou plus recent requis.
  %PY% --version
  pause
  exit /b 1
)

echo Telechargement des donnees Parcoursup (moins d'une minute)...
%PY% scripts\update_data.py
if errorlevel 1 (
  echo Telechargement impossible pour l'instant : l'outil utilisera le fichier fourni.
  echo Vous pourrez reessayer depuis l'onglet "Donnees".
) else (
  echo Donnees a jour.
)

echo.
echo Pour lire les resultats au format PDF (onglet Donnees, extraction des debouches), installez
echo pdftotext (paquet poppler) : https://github.com/oschwartz10612/poppler-windows/releases
echo Sans lui, la saisie manuelle des debouches reste disponible.
echo.
echo Installation terminee. Pour lancer Cap Prepa : double-clic sur lancer.bat
pause
