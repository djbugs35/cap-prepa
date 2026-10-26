# Cap Prépa

Outil d'aide aux vœux Parcoursup pour les **prépas scientifiques** (MPSI, MP2I, PCSI, PTSI, BCPST, TSI, TB, TPC) et les **écoles d'ingénieurs post-bac** (prépa intégrée). Il s'appuie uniquement sur les données ouvertes Parcoursup publiées par le ministère de l'Enseignement supérieur.

Ce qu'il permet :

- partir de **sa ville de résidence** et choisir un rayon de recherche ;
- filtrer par filière, public/privé, internat ;
- régler les notes de l'élève (maths, physique-chimie, maths expertes, anglais, français…) et voir un **score de dossier** par filière ;
- situer l'élève dans le **profil des admis** de chaque formation et obtenir une estimation de chances (de « Sécurité » à « Très ambitieux ») ;
- composer une **liste de vœux** et vérifier qu'elle est équilibrée.

C'est une aide au tri, pas une prédiction d'admission : la méthode et ses limites sont détaillées en bas de la page.

## Choisir la ville de résidence

Trois façons, de la plus prioritaire à la moins prioritaire :

1. **Dans l'adresse** : `index.html?ville=Rennes`
   Autres paramètres possibles : `rayon=200` (km, 25 à 600) et `filieres=MPSI,PCSI,ING`.
   Avec des coordonnées précises : `index.html?ville=Chez%20nous&lat=48.05&lon=-1.75`.
2. **Dans la page** : champ « Ville de résidence ». Toutes les communes françaises sont reconnues grâce à l'API publique `geo.api.gouv.fr`. Le bouton « Copier le lien de cette recherche » donne une adresse à partager.
3. **Par défaut** : `villeParDefaut` dans `config.js` (actuellement Rennes).

La dernière ville choisie est retenue dans le navigateur.

## Lancer l'outil

C'est un site statique, sans compilation. Il faut juste le servir en HTTP (un double-clic sur `index.html` ne permet pas de lire le fichier de données) :

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000/?ville=Rennes
```

### Publier avec GitHub Pages

Dans le dépôt GitHub : *Settings → Pages → Build and deployment → Deploy from a branch*, branche `main`, dossier `/ (root)`. L'outil sera ensuite accessible à l'adresse `https://djbugs35.github.io/cap-prepa/?ville=Rennes`.

## Données

`data/formations.json` contient une ligne par formation (session Parcoursup la plus récente, avec le taux d'accès de l'année précédente pour la tendance).

**Le fichier livré ne couvre que le Grand Ouest et l'Île-de-France** (environ 400 km autour de Rennes). Pour une autre région, ou pour mettre à jour après la publication d'une nouvelle session, régénérez-le :

```bash
python3 scripts/update_data.py                                       # toute la France métropolitaine
python3 scripts/update_data.py --ville-centre 48.111,-1.68 --rayon 400   # une zone seulement
```

Le script n'utilise que la bibliothèque standard de Python 3. Si le fichier ne couvre pas la zone choisie, la page l'indique.

Le workflow `.github/workflows/update-data.yml` fait la même chose automatiquement sur GitHub (lancement manuel depuis l'onglet *Actions*, puis le 1er de chaque mois d'octobre à février). Lancez-le une première fois pour passer à la couverture nationale.

Source : [jeu de données Parcoursup](https://data.enseignementsup-recherche.gouv.fr/explore/dataset/fr-esr-parcoursup/), Licence Ouverte / Open Licence (Etalab).

## Organisation des fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Page et styles |
| `app.js` | Logique : filtres, score de dossier, chances, carte, liste de vœux |
| `config.js` | Ville et filières par défaut, chemin des données |
| `data/formations.json` | Données Parcoursup préparées |
| `scripts/update_data.py` | Régénération des données depuis l'API officielle |

### Ajuster les pondérations

Les poids des matières par filière sont dans la constante `W` de `app.js`. Ce sont des hypothèses : aucune formation ne publie de barème chiffré. Les fiches Parcoursup (rubrique « Critères généraux d'examen des vœux ») donnent les priorités de chaque formation.

## Limites

- Parcoursup ne publie pas les admissions par lycée d'origine. La colonne « Académie » (part d'admis venant de la même académie) est le seul indicateur de recrutement local disponible.
- Les taux d'intégration en écoles après la prépa (statistiques SCEI) ne sont pas encore intégrés.
- Pour les concours communs (Geipi Polytech, Puissance Alpha, Avenir, Advance), les chiffres valent souvent pour l'ensemble du concours.
