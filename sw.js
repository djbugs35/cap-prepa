/* Service worker de Cap Prépa : l'outil reste consultable sans connexion après une première visite.
   Fichiers du site : servis depuis le cache puis mis à jour en arrière-plan (la nouvelle version apparaît à la visite suivante).
   Leaflet et les polices (adresses versionnées) : cache d'abord. Tuiles OpenStreetMap et géocodage : jamais mis en cache,
   la politique d'usage d'OpenStreetMap interdit de stocker des tuiles pour un usage hors ligne. */

// Changer ce nom à chaque modification de la liste ci-dessous : l'ancien cache est alors supprimé.
const CACHE="cap-prepa-v1";
// tests/sw.test.js vérifie que tout module de src/ figure ici : un oubli casserait l'outil hors ligne.
const FICHIERS=["./","index.html","config.js","data/formations.json",
  "src/main.js","src/calc.js","src/geo.js","src/carte.js","src/carte-osm.js","src/fiche.js","src/liste.js"];
const HOTES_VERSIONNES=["unpkg.com","fonts.googleapis.com","fonts.gstatic.com"];

self.addEventListener("install",e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FICHIERS)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

async function cacheEtMiseAJour(req){
  const c=await caches.open(CACHE);
  // ignoreSearch : index.html?ville=Nantes et index.html sont la même page.
  const enCache=await c.match(req,{ignoreSearch:req.mode==="navigate"});
  const reseau=fetch(req).then(r=>{if(r.ok)c.put(req,r.clone());return r;});
  if(enCache){reseau.catch(()=>{});return enCache;} // hors ligne : la copie en cache suffit
  return reseau;
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
  if(url.origin===self.location.origin) e.respondWith(cacheEtMiseAJour(req));
  else if(HOTES_VERSIONNES.includes(url.hostname)) e.respondWith(cacheDabord(req));
});
