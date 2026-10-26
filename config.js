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
  geoApi: "https://geo.api.gouv.fr/communes"
};
