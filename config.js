// Réglages par défaut de Cap Prépa.
// La ville peut aussi être donnée dans l'adresse : index.html?ville=Nantes&rayon=200
window.CAP_PREPA_CONFIG = {
  // Ville de résidence utilisée quand l'adresse n'en précise pas.
  villeParDefaut: "Rennes",
  // Rayon de recherche initial, en km (25 à 600).
  rayonParDefaut: 150,
  // Filières cochées au premier lancement.
  filieresParDefaut: ["MPSI", "MP2I", "PCSI", "PTSI", "ING"],
  // Fichier de données produit par scripts/update_data.py
  fichierDonnees: "data/formations.json",
  // Service de géocodage des communes (API publique de l'État, sans clé).
  geoApi: "https://geo.api.gouv.fr/communes",
  // Nombre minimal d'admis pour situer le dossier dans le profil des admis (sinon « Non estimable »).
  admisMinProfil: 15,
  // Chance minimale (0 à 1) des catégories Sécurité, Probable, Possible et Ambitieux ; en dessous : Très ambitieux.
  seuilsChances: [0.70, 0.55, 0.40, 0.25],
  // Part de la position du dossier parmi les admis dans la chance ; le reste vient du taux d'accès lissé sur 3 ans.
  partPosition: 0.65,
  // Écart de notes (en points) testé de part et d'autre pour afficher une fourchette, par exemple « Possible à probable ».
  ecartFourchette: 0.5,
  // Écart entre le plus haut et le plus bas taux d'accès des 3 sessions à partir duquel une formation est « instable ».
  ecartTauxInstable: 20,
  // Poids des matières à modifier, par filière (les autres gardent ceux de src/calc.js). Exemple : { PCSI: { pc: 5 } }
  poidsMatieres: {}
};
