/* Carte OpenStreetMap (Leaflet), chargée à la demande. Sans connexion, ou si les tuiles ne viennent pas,
   main.js reste sur la carte SVG de carte.js : ce module ne fait que signaler l'échec. */

const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function chargerFichier(tag,attrs){
  return new Promise((ok,ko)=>{const e=document.createElement(tag);Object.assign(e,attrs);e.crossOrigin="";
    e.onload=ok;e.onerror=()=>ko(new Error("chargement impossible : "+(attrs.src||attrs.href)));document.head.appendChild(e);});
}
/* Rend l'objet Leaflet global, ou null si la bibliothèque n'a pas pu être chargée avant delaiMs.
   cfg : {js, css, integriteJs, integriteCss} (config.js, clé carteLeaflet). */
export async function chargerLeaflet(cfg,delaiMs=6000){
  if(window.L) return window.L;
  if(navigator.onLine===false) return null;
  const delai=new Promise((_,ko)=>setTimeout(()=>ko(new Error("délai dépassé")),delaiMs));
  try{
    await Promise.race([Promise.all([
      chargerFichier("link",{rel:"stylesheet",href:cfg.css,integrity:cfg.integriteCss}),
      chargerFichier("script",{src:cfg.js,integrity:cfg.integriteJs})]),delai]);
    return window.L||null;
  }catch(e){console.warn("Carte OpenStreetMap indisponible, carte schématique utilisée :",e.message);return null;}
}

// Couleur réelle d'une variable CSS : Leaflet dessine en SVG avec des attributs, qui n'acceptent pas var().
const couleur=(el,v)=>getComputedStyle(el).getPropertyValue(v).trim()||"#888";

/* Crée la carte dans div et rend {afficher(home,radius,list,basket)}.
   surSelection(id) : clic sur une formation. surEchec() : les tuiles ne se chargent pas (hors ligne, serveur bloqué). */
export function creerCarteOsm(L,div,{tuiles,attribution},surSelection,surEchec){
  const carte=L.map(div,{scrollWheelZoom:false});
  let tuilesChargees=0,erreurs=0,dernierCadrage="";
  L.tileLayer(tuiles,{maxZoom:18,attribution}).on("tileload",()=>tuilesChargees++)
    .on("tileerror",()=>{if(++erreurs>=8&&!tuilesChargees)surEchec();}).addTo(carte);
  const calque=L.layerGroup().addTo(carte);
  function afficher(home,radius,list,basket){
    // Recadrer seulement quand le lieu ou le rayon change : sinon chaque mouvement de curseur ferait sauter la carte.
    const cadrage=home.lat+","+home.lon+","+radius;
    if(cadrage!==dernierCadrage){dernierCadrage=cadrage;carte.fitBounds(L.latLng(home.lat,home.lon).toBounds(radius*2000),{padding:[8,8]});}
    calque.clearLayers();
    L.circle([home.lat,home.lon],{radius:radius*1000,color:couleur(div,"--line"),weight:1.5,fill:false,interactive:false}).addTo(calque);
    L.circleMarker([home.lat,home.lon],{radius:6,color:couleur(div,"--marge"),weight:3,fillOpacity:0}).bindTooltip(esc(home.name)).addTo(calque);
    const ordre=[...list].sort((a,b)=>(a.ch.c??-1)-(b.ch.c??-1)); // les meilleures chances dessinées en dernier, donc au-dessus
    for(const r of ordre){
      const dansListe=basket.includes(r.id);
      L.circleMarker([r.lat,r.lon],{radius:dansListe?8:6,color:couleur(div,dansListe?"--ink":"--card"),weight:dansListe?2.5:1,
        fillColor:couleur(div,"--c"+r.ch.cat.k),fillOpacity:.95})
        .bindTooltip(`${esc(r.etab)} · ${r.fil==="ING"?"École":r.fil} · ${r.ch.cat.l}`)
        .on("click",()=>surSelection(r.id)).addTo(calque);
    }
  }
  return {afficher};
}
