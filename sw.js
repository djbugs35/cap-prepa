/* Service worker de Cap Prépa : l'outil reste consultable sans connexion après une première visite.
   Fichiers du site : servis depuis le cache puis mis à jour en arrière-plan (la nouvelle version apparaît à la visite suivante).
   Leaflet et les polices (adresses versionnées) : cache d'abord. Tuiles OpenStreetMap et géocodage : jamais mis en cache,
   la politique d'usage d'OpenStreetMap interdit de stocker des tuiles pour un usage hors ligne. */

// Changer ce nom à chaque modification de la liste ci-dessous : l'ancien cache est alors supprimé.
const CACHE="cap-prepa-v8";
// tests/sw.test.js vérifie que tout module de src/ figure ici : un oubli casserait l'outil hors ligne.
const FICHIERS=["./","index.html","config.js","data/formations.json","data/lycees.json","data/liens-resultats.json",
  "src/main.js","src/calc.js","src/geo.js","src/carte.js","src/carte-osm.js","src/fiche.js","src/liste.js","src/donnees.js","src/classements.js","src/debouches.js"];
const HOTES_VERSIONNES=["unpkg.com","fonts.googleapis.com","fonts.gstatic.com"];

self.addEventListener("install",e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FICHIERS)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

// index.html?lycee=… et index.html sont la même page : on la range sous son adresse sans paramètres.
// Bug corrigé : la version fraîche était rangée sous l'adresse complète, et l'ancienne restait servie indéfiniment.
const cleDeCache=req=>{if(req.mode!=="navigate")return req;const u=new URL(req.url);u.search="";u.hash="";return new Request(u.href);};
async function cacheEtMiseAJour(req){
  const c=await caches.open(CACHE),cle=cleDeCache(req);
  const enCache=await c.match(cle,{ignoreSearch:req.mode==="navigate"});
  const reseau=fetch(req).then(r=>{if(r.ok)c.put(cle,r.clone());return r;});
  if(enCache){reseau.catch(()=>{});return enCache;} // hors ligne : la copie en cache suffit
  return reseau;
}
// Données : le réseau d'abord, pour qu'une mise à jour depuis l'onglet « Données » se voie au premier rechargement.
async function reseauDabord(req){
  const c=await caches.open(CACHE);
  try{const r=await fetch(req);if(r.ok)c.put(req,r.clone());return r;}
  catch(e){const enCache=await c.match(req);if(enCache)return enCache;throw e;}
}
async function cacheDabord(req){
  const c=await caches.open(CACHE),enCache=await c.match(req);
  if(enCache) return enCache;
  const r=await fetch(req);
  if(r.ok) c.put(req,r.clone());
  return r;
}
self.addEventListener("fetch",e=>{
  const req=e.request;
  if(req.method!=="GET") return;
  const url=new URL(req.url);
  if(url.origin===self.location.origin&&url.pathname.startsWith("/api/")) return; // serveur local : toujours en direct
  if(url.origin===self.location.origin&&url.pathname.endsWith("/data/formations.json")) e.respondWith(reseauDabord(req));
  else if(url.origin===self.location.origin) e.respondWith(cacheEtMiseAJour(req));
  else if(HOTES_VERSIONNES.includes(url.hostname)) e.respondWith(cacheDabord(req));
});
