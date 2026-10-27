# Origine de ces fichiers

Classements publiés par **L'Étudiant** (letudiant.fr), transcrits à la main depuis le site le 27 octobre 2026
pour servir de « classement personnel » importable dans Cap Prépa (voir `src/classements.js`,
`lireCsvClassements`). Ce ne sont pas des données ouvertes : Cap Prépa n'en republie pas le contenu éditorial
(méthodologie, pondérations, textes), seulement les couples (établissement, rang) nécessaires à l'import,
retrouvables en consultant les pages sources ci-dessous.

| Fichier | Page source |
|---|---|
| `MP/panier-large.csv` | <https://www.letudiant.fr/classements/classement-des-prepas-scientifiques-mp-maths-physique/vous-visez-panier-large.html> |
| `MPI/panier-large.csv` | <https://www.letudiant.fr/classements/classement-des-prepas-mpi-maths-physique-et-informatique/vous-visez-panier-large.html> |
| `PC/panier-large.csv` | <https://www.letudiant.fr/classements/classement-des-prepas-scientifiques-pc-physique-chimie/vous-visez-panier-large.html> |
| `PSI/panier-large.csv` | <https://www.letudiant.fr/classements/classement-des-prepas-scientifiques-psi-physique-et-sciences-de-lingenieur/vous-visez-panier-large.html> |
| `PT/panier-large.csv` | <https://www.letudiant.fr/classements/classement-des-prepas-scientifiques-pt-physique-et-technologie/vous-visez-panier-large.html> |
| `ING/classement-general.csv` | <https://www.letudiant.fr/classements/classement-des-ecoles-d-ingenieurs.html> |

Les rangs d'une même ligne du site (ex æquo) ont été reportés tels quels. Deux limites connues, propres à cette
transcription et non au site source : un écart de rang (119-120) manquant sur `MP` et `PSI` faute d'avoir pu le
relire sur le site, et, pour `ING`, les écoles classées au-delà du rang 40 n'ont qu'une tranche de 20 (le site
lui-même ne publie pas de rang individuel au-delà). Environ la moitié des écoles du classement général (celles qui
recrutent surtout après une prépa, via le concours national SCEI, et non par un vœu Parcoursup direct) sont
absentes des fichiers : Cap Prépa ne les référence pas (voir `data/formations.json`).
