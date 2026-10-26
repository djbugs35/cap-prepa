# Cap Prépa — consignes projet

## Public visé (priorité absolue)
Élève de **terminale générale** avec spécialités **maths + physique-chimie** et option **maths expertes**,
qui vise une **CPGE scientifique** (MPSI, MP2I, PCSI, PTSI, BCPST) ou une **école d'ingénieurs post-bac**
(prépa intégrée). L'outil doit être le plus efficace possible pour ce cas avant toute extension.

Hors périmètre pour l'instant : bacs technologiques (TSI, TB, TPC), prépas économiques et littéraires,
autres doublettes de spécialités.

## Choix techniques
- JavaScript sans compilation (modules ES dans `src/`), site statique servi en HTTP.
- `src/calc.js` reste pur (pas de DOM, pas de réseau) : tout calcul y va et y est testé.
- Carte : OpenStreetMap (Leaflet) par défaut, repli sur la carte SVG (`src/carte.js`) sans connexion.
- Aucune donnée personnelle collectée : tout reste dans le navigateur (public mineur).
- Données : open data Parcoursup uniquement, via `scripts/update_data.py` (bibliothèque standard).

## Conventions (reprises de metascrap, docs/CONVENTIONS.md de ce dépôt-là)
- Le code est lu par quelqu'un qui a oublié le contexte : la règle qui sert le lecteur gagne.
- Domaine en français ; en Python, identifiants sans accents : `verbe_complement()`, prédicats `est_x()`,
  `_prive`, `MAJUSCULES`. Booléens nommés par ce qu'ils affirment. Pas d'abréviations hors domaine.
- Fonctions ≤ 50 lignes ; > 80 refusé sur du code neuf. Module > 800 lignes : à découper.
- Docstring Google sur toute fonction publique : 1re ligne = ce qu'elle rend, à l'infinitif ;
  puis seulement le non-évident ; `Raises:` si l'appelant doit attraper.
- Commentaires : le pourquoi (chiffre mesuré, ce qui casse si on l'enlève), jamais le quoi.
- Erreurs : attraper le type qu'on sait traiter, jamais `except Exception` hors frontière journalisée.
- Imports en tête de module. Deux fois on note, trois fois on factorise. Un nom = un concept.
- Configuration (`config.js`) : toutes les clés lues par le code y figurent, avec leur valeur par défaut
  et une phrase disant à quoi elle sert.
- Tests : un test par comportement, nommé par ce qu'il garantit ; le test d'un bug corrigé reproduit le
  bug et son docstring raconte ce qui s'était passé ; aucun test ne touche au réseau.
- Écritures de fichiers atomiques (temporaire puis renommage). Réseau : reprises exponentielles.

## Façon de travailler
- Frugalité en tokens : filtrer les sorties avant de les lire, ne pas relire un fichier qu'on vient d'éditer.
- Lancer seulement les tests des fichiers touchés.
- Ne pas modifier README ni docs sans demande : l'utilisateur les reprend avant chaque version.
- Ne jamais tuer un processus qu'on n'a pas lancé soi-même.

## Vérifications avant commit
- `npm test` (node --test) et `pytest -q tests`
- `ruff check scripts tests` et `ruff format scripts tests`
- Conventional commits en français (`feat:`, `fix:`, `chore:`), une branche par fonctionnalité.
