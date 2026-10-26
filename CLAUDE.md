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

## Vérifications avant commit
- `npm test` (node --test) et `pytest -q tests`
- `ruff check scripts tests`
- Conventional commits, une branche par fonctionnalité.
