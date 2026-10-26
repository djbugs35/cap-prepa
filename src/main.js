/* Cap Prépa — aide aux vœux Parcoursup (CPGE scientifiques et écoles d'ingénieurs post-bac).
   Données : data/formations.json, produit par scripts/update_data.py à partir de l'open data Parcoursup.
   Paramètres d'adresse : ?ville=Rennes&rayon=150&filieres=MPSI,PCSI  (ou ?lat=48.11&lon=-1.68) */
import {FILS,W,CH,NON_ESTIMABLE,dist,norm,score,estimation,basculerComparaison,encoderPartage,decoderPartage,libelleFourchette,reglagesDepuis,avertissementMathsExpertes,filterRows,sortRows,rowsFromData,internatInconnu,tauxRef} from "./calc.js";
import {geocode,suggestions} from "./geo.js";
import {renderSvgMap} from "./carte.js";
import {chargerLeaflet,creerCarteOsm} from "./carte-osm.js";
import {htmlFiche,htmlComparaison} from "./fiche.js";
import {htmlListe,htmlImpression} from "./liste.js";

const CFG=Object.assign({
  villeParDefaut:"Rennes",rayonParDefaut:150,
  filieresParDefaut:["MPSI","MP2I","PCSI","PTSI","ING"],
  fichierDonnees:"data/formations.json",geoApi:"https://geo.api.gouv.fr/communes",
  carteOsm:{tuiles:"https://tile.openstreetmap.org/{z}/{x}/{y}.png",attribution:"&copy; contributeurs OpenStreetMap"},
  carteLeaflet:{
    js:"https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",css:"https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    integriteJs:"sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=",integriteCss:"sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="}
},window.CAP_PREPA_CONFIG||{});
const R=reglagesDepuis(CFG);

const NOTES=[["m","Maths (spécialité)"],["pc","Physique-chimie (spécialité)"],["mx","Maths expertes"],["s3","Spécialité abandonnée en 1re"],["an","Anglais"],["fr","Français (épreuves anticipées)"],["au","Moyenne des autres matières"]];
const MCOL=["var(--m1)","var(--m2)","var(--m3)","var(--m4)","var(--m5)"];
const MLAB=["TB félicitations","TB","B","AB","Sans mention"];

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=x=>(Math.round(x*10)/10).toFixed(1).replace(".",",");

// ---------- état ----------
const DEF={home:null,radius:CFG.rayonParDefaut,fils:CFG.filieresParDefaut.filter(f=>W[f]),pub:false,intern:false,
  n:{m:15,pc:14,mx:14,s3:14,an:14,fr:13,au:13},mxon:true,s3type:"SVT",avis:"F",sort:"chance",q:"",basket:[],compare:[],internats:{}};
let st=JSON.parse(JSON.stringify(DEF));
try{const s=localStorage.getItem("capprepa");if(s){const o=JSON.parse(s);st=Object.assign(st,o);st.n=Object.assign({},DEF.n,o.n||{});}}catch(e){}
st.fils=st.fils.filter(f=>W[f]); // filières retirées depuis la dernière visite
function save(){try{localStorage.setItem("capprepa",JSON.stringify(st));}catch(e){}}

let rows=[],META={};
let limit=60,flashId=null,osm=null,affichees=[];
const chanceOf=r=>estimation(r,st,R,META.sessionsHist||[]);

// ---------- ville ----------
async function setCity(name,quiet){
  $("city-msg").textContent="Recherche de « "+name+" »…";
  const c=await geocode(CFG.geoApi,name);
  if(!c){$("city-msg").textContent="Ville introuvable. Vérifiez l'orthographe ou essayez une commune voisine.";return false;}
  st.home=c;$("city").value=c.name;
  $("city-msg").textContent=quiet?"":"Point de départ : "+c.name+(c.dep?" ("+c.dep+")":"")+".";
  upd();return true;
}

// ---------- adresse (paramètres) ----------
function readParams(){
  const p=new URLSearchParams(location.search);
  const out={};
  if(p.get("ville")) out.ville=p.get("ville");
  if(p.get("lat")&&p.get("lon")&&!isNaN(+p.get("lat"))&&!isNaN(+p.get("lon"))) out.coords={name:p.get("ville")||"Point choisi",lat:+p.get("lat"),lon:+p.get("lon")};
  if(p.get("rayon")&&!isNaN(+p.get("rayon"))) out.rayon=Math.max(25,Math.min(600,+p.get("rayon")));
  if(p.get("filieres")){const f=p.get("filieres").split(",").map(s=>s.trim().toUpperCase()).filter(x=>W[x]);if(f.length)out.fils=f;}
  return out;
}
function shareUrl(){
  const u=new URL(location.href);
  const parts=[];
  if(st.home) parts.push("ville="+encodeURIComponent(st.home.name));
  parts.push("rayon="+st.radius,"filieres="+st.fils.join(","));
  u.search="?"+parts.join("&");u.hash="";
  return u.toString();
}
function writeParams(){try{history.replaceState(null,"",shareUrl());}catch(e){}}

function filtered(){
  return filterRows(rows,st).map(r=>Object.assign(r,{ch:chanceOf(r)}));
}

// ---------- rendu ----------
function renderScores(){
  const fs=FILS.map(f=>f[0]).filter(f=>st.fils.includes(f));
  $("scores").innerHTML=fs.length?fs.map(f=>{const s=score(f,st,R.poids);
    return `<span>${f==="ING"?"Écoles":f}</span><span class="bar"><i style="width:${Math.max(0,(s-6)/14*100)}%"></i></span><span class="mono">${fmt(s)}</span>`;}).join("")
    :`<span class="hint" style="grid-column:1/-1">Choisissez au moins une filière.</span>`;
  NOTES.forEach(([k])=>{$("o-"+k).textContent=fmt(st.n[k]);});
  $("n-mx").disabled=!st.mxon;
  const mx=avertissementMathsExpertes(st,st.fils);$("mx-warn").hidden=!mx;$("mx-warn").textContent=mx||"";
  $("radius-o").textContent=st.radius+" km";
  $("h-city").textContent=st.home?st.home.name:"";
  document.title="Cap Prépa"+(st.home?" · "+st.home.name:"");
}
function renderCoverage(){
  const cov=META.coverage,el=$("coverage");
  if(!cov||!st.home){el.hidden=true;return;}
  const d=dist(st.home.lat,st.home.lon,cov.center[0],cov.center[1]);
  if(d+st.radius<=cov.radiusKm){el.hidden=true;return;}
  el.hidden=false;
  el.innerHTML=`<b>Données partielles pour cette zone.</b>Le fichier de données ne couvre que : ${esc(cov.label)}. Pour toute la France, lancez <code>python3 scripts/update_data.py</code> (voir le README).`;
}
function mbar(r){
  if(!r.ch.p) return `<div class="msub">Trop peu d'admis (${r.admis}) pour situer le dossier</div>`;
  const tot=r.mp.reduce((a,b)=>a+b,0);
  const segs=r.mp.map((v,i)=>v>0?`<i style="width:${v/tot*100}%;background:${MCOL[i]}" title="${MLAB[i]} : ${v} %"></i>`:"").join("");
  return `<div class="mbar">${segs}<span class="me" style="left:${r.ch.p.x}%" title="Position estimée de l'élève"></span></div><div class="msub">${r.mp[0]+r.mp[1]} % TB · ${r.mp[2]} % B · ${r.mp[3]+r.mp[4]} % AB ou moins</div>`;
}
// Tendance comparée à la session précédente, sur le même indicateur que celui affiché.
function trend(r,prevY){
  const hist=r.tauxGen!=null?r.tauxGenHist:r.tauxHist,prev=hist.length?hist[hist.length-1]:null;
  if(prev==null) return "";
  const d=tauxRef(r)-prev,cls=d<=-5?"trend-down":d>=5?"trend-up":"",fl=d<=-5?"↓ ":d>=5?"↑ ":"";
  return `<small class="${cls}">${fl}${prev} % en ${prevY}</small>`;
}
function tauxCell(r,prevY){
  const off=r.tauxGen!=null&&r.tauxGen!==r.taux?`<small title="Taux officiel, tous candidats confondus (réorientations comprises)">officiel ${r.taux} %</small>`:"";
  const inst=r.ch.instable?`<small class="trend-down" title="Le taux d'accès a varié d'au moins ${R.ecartTauxInstable} points sur 3 sessions">instable</small>`:"";
  return `${tauxRef(r)} %${off}${trend(r,prevY)}${inst}`;
}
function renderList(all){
  const shown=all.slice(0,limit),prevY=(META.sessionsHist||[]).slice(-1)[0]||META.previousSession||"";
  let h=`<div class="item head"><span>Chances</span><span>Formation</span><span title="Taux d'accès estimé pour les élèves de terminale générale">Accès term. G</span><span>Profil des admis (mention au bac)</span><span>Académie · places</span><span></span></div>`;
  if(!all.length) h+=`<div class="empty">${st.home?"Aucune formation ne correspond. Élargissez le rayon ou ajoutez une filière.":"Indiquez une ville de résidence pour commencer."}</div>`;
  shown.forEach(r=>{
    const inB=st.basket.includes(r.id),inC=st.compare.includes(r.id);
    const intern=r.filles?" · internat filles":r.intern?" · internat":internatInconnu(r)?" · internat non renseigné":"";
    h+=`<div class="item${flashId===r.id?" flash":""}" id="it-${r.id}">
      <span class="c-ch"><span class="pill k${r.ch.cat.k}">${r.ch.cat.l}</span>${r.ch.bas.k!==r.ch.haut.k?`<small title="Selon que les notes finales sont de ${fmt(R.ecartFourchette)} point plus basses ou plus hautes">${libelleFourchette(r.ch)}</small>`:""}</span>
      <span class="c-n name"><span class="badge${r.pub?"":" priv"}">${r.fil==="ING"?"École":r.fil}</span>${esc(r.etab)}<small>${esc(r.ville)} · ${Math.round(r.d)} km${r.det?" · "+esc(r.det):""}${r.pub?"":" · privé"}${intern}</small>
        <details class="why"><summary>Pourquoi ?</summary><ul>${r.ch.raisons.map(t=>`<li>${esc(t)}</li>`).join("")}</ul></details></span>
      <span class="c-t num">${tauxCell(r,prevY)}</span>
      <span class="c-m">${mbar(r)}</span>
      <span class="c-d num">${r.aca} %<small>${r.capa} places · ${(r.voeux??0).toLocaleString("fr-FR")} vœux</small></span>
      <span class="c-a acts"><button type="button" class="btn${inB?" on":""}" data-add="${r.id}">${inB?"Dans la liste":"Ajouter"}</button><button type="button" class="btn ghost" data-fiche="${r.id}">Fiche</button><button type="button" class="btn ghost${inC?" on":""}" data-cmp="${r.id}" aria-pressed="${inC}">Comparer</button></span>
    </div>`;});
  if(all.length>limit) h+=`<div class="more"><button type="button" class="btn" id="more">Afficher ${Math.min(60,all.length-limit)} de plus (${all.length-limit} restantes)</button></div>`;
  $("list").innerHTML=h;
  const m=$("more");if(m)m.onclick=()=>{limit+=60;renderList(all);};
}
// Formations choisies par identifiant, avec distance et estimation (hors des filtres de la liste).
const formationsParId=ids=>ids.map(id=>rows.find(r=>r.id===id)).filter(Boolean)
  .map(r=>Object.assign({d:st.home?dist(st.home.lat,st.home.lon,r.lat,r.lon):0},r)).map(r=>Object.assign(r,{ch:chanceOf(r)}));
function ouvrirDialogue(html){$("fiche-corps").innerHTML=html;const d=$("fiche");if(!d.open)d.showModal();}
function renderCompareBar(){
  const n=st.compare.length,el=$("compare-bar");
  el.hidden=!n;if(!n)return;
  el.innerHTML=`<span>${n} formation${n>1?"s":""} à comparer (4 au plus).</span><button type="button" class="btn" id="cmp-go"${n<2?" disabled":""}>Comparer</button><button type="button" class="btn ghost" id="cmp-clear">Vider</button>`;
}
function renderBasket(){
  const items=formationsParId(st.basket).sort((a,b)=>(b.ch.c??-1)-(a.ch.c??-1));
  $("basket").innerHTML=htmlListe(items,st.internats);
  $("impression").innerHTML=items.length?htmlImpression(items,st,st.internats,META.session):"";
}
// OpenStreetMap si Leaflet est chargé et les tuiles arrivent, carte schématique sinon.
function dessinerCarte(){
  if(!st.home){$("map").innerHTML="";return;}
  if(osm) osm.afficher(st.home,st.radius,affichees,st.basket);
  else renderSvgMap($("map"),st.home,st.radius,affichees,st.basket);
}
function basculerCarte(L){
  // toggleAttribute : un élément SVG n'a pas de propriété hidden, seulement l'attribut.
  const montrerOsm=oui=>{$("map-osm").hidden=!oui;$("map").toggleAttribute("hidden",oui);};
  const surEchec=()=>{osm=null;montrerOsm(false);dessinerCarte();};
  montrerOsm(true);
  osm=creerCarteOsm(L,$("map-osm"),CFG.carteOsm,selectionner,surEchec);
  dessinerCarte();
}
// Met en avant la formation choisie sur la carte et fait défiler la liste jusqu'à elle.
function selectionner(id){
  flashId=id;
  const all=sortRows(filtered(),st.sort);const idx=all.findIndex(r=>r.id===id);if(idx>=limit)limit=idx+10;renderList(all);
  const el=document.getElementById("it-"+id);if(el)el.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"center"});
}
function upd(keepLimit){
  if(!keepLimit){limit=60;flashId=null;}
  save();writeParams();renderScores();renderCoverage();
  const all=sortRows(filtered(),st.sort);
  $("count").textContent=all.length+" formation"+(all.length>1?"s":"");
  affichees=all;dessinerCarte();
  renderList(all);renderBasket();renderCompareBar();
}

// ---------- contrôles ----------
function initControls(){
  let t=null;
  $("city").oninput=e=>{clearTimeout(t);t=setTimeout(async()=>{
    const list=await suggestions(CFG.geoApi,e.target.value.trim());
    if(list.length)$("city-list").innerHTML=list.map(c=>`<option value="${esc(c.nom)}">${esc(c.nom)} (${esc(c.codeDepartement)})</option>`).join("");
  },250);};
  $("city-form").onsubmit=e=>{e.preventDefault();const v=$("city").value.trim();if(v)setCity(v);};
  $("city").onchange=e=>{const v=e.target.value.trim();if(v&&(!st.home||norm(v)!==norm(st.home.name)))setCity(v);};
  const r=$("radius");r.value=st.radius;r.oninput=()=>{st.radius=+r.value;upd();};
  $("share").onclick=async()=>{const u=shareUrl();try{await navigator.clipboard.writeText(u);$("city-msg").textContent="Lien copié.";}catch(e){$("city-msg").textContent=u;}};
  $("fils").innerHTML=FILS.map(([k,l])=>`<button type="button" class="chip" data-f="${k}" aria-pressed="${st.fils.includes(k)}">${l}</button>`).join("");
  $("fils").onclick=e=>{const b=e.target.closest(".chip");if(!b)return;const f=b.dataset.f;st.fils=st.fils.includes(f)?st.fils.filter(x=>x!==f):[...st.fils,f];b.setAttribute("aria-pressed",st.fils.includes(f));upd();};
  $("pub").checked=st.pub;$("pub").onchange=e=>{st.pub=e.target.checked;upd();};
  $("intern").checked=st.intern;$("intern").onchange=e=>{st.intern=e.target.checked;upd();};
  $("sliders").innerHTML=NOTES.map(([k,l])=>`<label class="row" for="n-${k}">${l} <output id="o-${k}"></output><input type="range" id="n-${k}" min="6" max="20" step="0.5" value="${st.n[k]}"></label>`).join("");
  NOTES.forEach(([k])=>{const i=$("n-"+k);i.oninput=()=>{st.n[k]=+i.value;upd(true);};});
  $("mxon").checked=st.mxon;$("mxon").onchange=e=>{st.mxon=e.target.checked;upd();};
  $("s3type").value=st.s3type;$("s3type").onchange=e=>{st.s3type=e.target.value;upd();};
  $("avis").value=st.avis;$("avis").onchange=e=>{st.avis=e.target.value;upd();};
  $("sort").value=st.sort;$("sort").onchange=e=>{st.sort=e.target.value;upd();};
  $("q").value=st.q;$("q").oninput=e=>{st.q=e.target.value;upd();};
  $("legend").innerHTML=[...CH,NON_ESTIMABLE].map(c=>`<span><i class="dot" style="background:var(--c${c.k})"></i>${c.l}</span>`).join("");
  $("map").addEventListener("click",e=>{const c=e.target.closest("circle[data-id]");if(c)selectionner(+c.dataset.id);});
  $("list").addEventListener("click",e=>{
    const f=e.target.closest("[data-fiche]");
    if(f){ouvrirDialogue(htmlFiche(formationsParId([+f.dataset.fiche])[0],META.sessionsHist||[],META.session));return;}
    const c=e.target.closest("[data-cmp]");
    if(c){st.compare=basculerComparaison(st.compare,+c.dataset.cmp);upd(true);return;}
    const b=e.target.closest("[data-add]");if(!b)return;const id=+b.dataset.add;
    st.basket=st.basket.includes(id)?st.basket.filter(x=>x!==id):[...st.basket,id];upd(true);});
  $("compare-bar").addEventListener("click",e=>{
    if(e.target.id==="cmp-go") ouvrirDialogue(htmlComparaison(formationsParId(st.compare)));
    if(e.target.id==="cmp-clear"){st.compare=[];upd(true);}});
  $("basket").addEventListener("click",async e=>{
    if(e.target.id==="bk-print"){window.print();return;}
    if(e.target.id==="bk-share"){
      const u=shareUrl()+encoderPartage(st);
      try{await navigator.clipboard.writeText(u);$("bk-msg").textContent="Lien copié. Il contient les notes saisies : ne le partagez qu'avec des personnes de confiance.";}
      catch(err){$("bk-msg").textContent=u;}
      return;}
    const b=e.target.closest("[data-rm]");if(!b)return;st.basket=st.basket.filter(x=>x!==+b.dataset.rm);upd(true);});
  $("basket").addEventListener("change",e=>{const s=e.target.closest("[data-internat]");if(!s)return;
    st.internats={...st.internats,[s.dataset.internat]:s.value};save();renderBasket();});
}

// ---------- démarrage ----------
// Garde l'outil consultable hors ligne (sw.js). Seulement en HTTP(S) : en file:// le navigateur le refuse.
function enregistrerHorsLigne(){
  if(!("serviceWorker" in navigator)||!/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register("sw.js").catch(e=>console.warn("Mode hors ligne indisponible :",e.message));
}
async function start(){
  enregistrerHorsLigne();
  try{
    const res=await fetch(CFG.fichierDonnees);
    if(!res.ok) throw new Error("HTTP "+res.status);
    const data=await res.json();META=data.meta||{};
    rows=rowsFromData(data).filter(r=>W[r.fil]);
    if(META.session) $("h-session").textContent=META.session;
  }catch(e){
    $("list").innerHTML=`<div class="empty">Impossible de lire ${esc(CFG.fichierDonnees)} (${esc(e.message)}). Ouvrez l'outil via un petit serveur web, par exemple <code>python3 -m http.server</code>, pas en double-cliquant sur le fichier.</div>`;
    return;
  }
  const p=readParams(),partage=decoderPartage(location.hash);
  // Liste reçue par lien : elle remplace la liste et les notes enregistrées dans ce navigateur.
  if(partage){Object.assign(st,partage);st.n=Object.assign({},DEF.n,st.n);}
  if(p.rayon) st.radius=p.rayon;
  if(p.fils) st.fils=p.fils;
  initControls();
  if(p.coords){st.home=p.coords;$("city").value=p.coords.name;upd();}
  else if(p.ville) await setCity(p.ville,true);
  else if(st.home){$("city").value=st.home.name;upd();}
  else await setCity(CFG.villeParDefaut,true);
  const L=await chargerLeaflet(CFG.carteLeaflet);
  if(L) basculerCarte(L);
}
start();
