/* Cap Prépa — aide aux vœux Parcoursup (CPGE scientifiques et écoles d'ingénieurs post-bac).
   Données : data/formations.json, produit par scripts/update_data.py à partir de l'open data Parcoursup.
   Paramètres d'adresse : ?ville=Rennes&rayon=150&filieres=MPSI,PCSI  (ou ?lat=48.11&lon=-1.68) */
import {FILS,W,CH,NON_ESTIMABLE,dist,norm,score,chance,filterRows,sortRows,vowKey,balanceAdvice,rowFromArray,internatInconnu} from "./calc.js";
import {geocode,suggestions} from "./geo.js";
import {renderSvgMap} from "./carte.js";

const CFG=Object.assign({
  villeParDefaut:"Rennes",rayonParDefaut:150,
  filieresParDefaut:["MPSI","MP2I","PCSI","PTSI","ING"],
  fichierDonnees:"data/formations.json",geoApi:"https://geo.api.gouv.fr/communes",
  admisMinProfil:15
},window.CAP_PREPA_CONFIG||{});

const NOTES=[["m","Maths (spécialité)"],["pc","Physique-chimie (spécialité)"],["mx","Maths expertes"],["s3","Spécialité abandonnée en 1re"],["an","Anglais"],["fr","Français (épreuves anticipées)"],["au","Moyenne des autres matières"]];
const MCOL=["var(--m1)","var(--m2)","var(--m3)","var(--m4)","var(--m5)"];
const MLAB=["TB félicitations","TB","B","AB","Sans mention"];

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=x=>(Math.round(x*10)/10).toFixed(1).replace(".",",");

// ---------- état ----------
const DEF={home:null,radius:CFG.rayonParDefaut,fils:CFG.filieresParDefaut.filter(f=>W[f]),pub:false,intern:false,
  n:{m:15,pc:14,mx:14,s3:14,an:14,fr:13,au:13},mxon:true,s3type:"SVT",avis:"F",sort:"chance",q:"",basket:[]};
let st=JSON.parse(JSON.stringify(DEF));
try{const s=localStorage.getItem("capprepa");if(s){const o=JSON.parse(s);st=Object.assign(st,o);st.n=Object.assign({},DEF.n,o.n||{});}}catch(e){}
st.fils=st.fils.filter(f=>W[f]); // filières retirées depuis la dernière visite
function save(){try{localStorage.setItem("capprepa",JSON.stringify(st));}catch(e){}}

let rows=[],META={};
let limit=60,flashId=null;
const chanceOf=r=>chance(r,st,CFG.admisMinProfil);

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
  $("scores").innerHTML=fs.length?fs.map(f=>{const s=score(f,st);
    return `<span>${f==="ING"?"Écoles":f}</span><span class="bar"><i style="width:${Math.max(0,(s-6)/14*100)}%"></i></span><span class="mono">${fmt(s)}</span>`;}).join("")
    :`<span class="hint" style="grid-column:1/-1">Choisissez au moins une filière.</span>`;
  NOTES.forEach(([k])=>{$("o-"+k).textContent=fmt(st.n[k]);});
  $("n-mx").disabled=!st.mxon;
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
const linkFor=id=>"https://dossierappel.parcoursup.fr/Candidats/public/fiches/afficherFicheFormation?g_ta_cod="+id+"&typeBac=0&originePc=0";
function renderList(all){
  const shown=all.slice(0,limit),prevY=META.previousSession||"";
  let h=`<div class="item head"><span>Chances</span><span>Formation</span><span>Taux d'accès</span><span>Profil des admis (mention au bac)</span><span>Académie · places</span><span></span></div>`;
  if(!all.length) h+=`<div class="empty">${st.home?"Aucune formation ne correspond. Élargissez le rayon ou ajoutez une filière.":"Indiquez une ville de résidence pour commencer."}</div>`;
  shown.forEach(r=>{
    const tr=r.t24==null?"":r.taux-r.t24<=-5?`<small class="trend-down">↓ ${r.t24} % en ${prevY}</small>`:r.taux-r.t24>=5?`<small class="trend-up">↑ ${r.t24} % en ${prevY}</small>`:`<small>${r.t24} % en ${prevY}</small>`;
    const inB=st.basket.includes(r.id);
    const intern=r.intern?" · internat":internatInconnu(r)?" · internat non renseigné":"";
    h+=`<div class="item${flashId===r.id?" flash":""}" id="it-${r.id}">
      <span class="c-ch"><span class="pill k${r.ch.cat.k}">${r.ch.cat.l}</span></span>
      <span class="c-n name"><span class="badge${r.pub?"":" priv"}">${r.fil==="ING"?"École":r.fil}</span>${esc(r.etab)}<small>${esc(r.ville)} · ${Math.round(r.d)} km${r.det?" · "+esc(r.det):""}${r.pub?"":" · privé"}${intern}</small></span>
      <span class="c-t num">${r.taux} %${tr}</span>
      <span class="c-m">${mbar(r)}</span>
      <span class="c-d num">${r.aca} %<small>${r.capa} places · ${(r.voeux??0).toLocaleString("fr-FR")} vœux</small></span>
      <span class="c-a acts"><button type="button" class="btn${inB?" on":""}" data-add="${r.id}">${inB?"Dans la liste":"Ajouter"}</button><a class="btn ghost" href="${linkFor(r.id)}" target="_blank" rel="noopener">Fiche</a></span>
    </div>`;});
  if(all.length>limit) h+=`<div class="more"><button type="button" class="btn" id="more">Afficher ${Math.min(60,all.length-limit)} de plus (${all.length-limit} restantes)</button></div>`;
  $("list").innerHTML=h;
  const m=$("more");if(m)m.onclick=()=>{limit+=60;renderList(all);};
}
function renderBasket(){
  const items=st.basket.map(id=>rows.find(r=>r.id===id)).filter(Boolean)
    .map(r=>Object.assign({d:st.home?dist(st.home.lat,st.home.lon,r.lat,r.lon):0},r)).map(r=>Object.assign(r,{ch:chanceOf(r)}))
    .sort((a,b)=>(b.ch.c??-1)-(a.ch.c??-1));
  if(!items.length){$("basket").innerHTML=`<p class="hint">Cliquez sur « Ajouter » pour construire une liste et vérifier qu'elle est équilibrée.</p>`;return;}
  const cnt=[0,0,0,0,0,0];items.forEach(r=>cnt[r.ch.cat.k]++);
  const vows=new Set(items.map(vowKey)).size;
  const cats=[...CH,NON_ESTIMABLE];
  $("basket").innerHTML=`<div class="balance">${cats.map(c=>cnt[c.k]?`<i style="width:${cnt[c.k]/items.length*100}%;background:var(--c${c.k})" title="${c.l} : ${cnt[c.k]}"></i>`:"").join("")}</div>
   <p class="advice"><b class="mono">${vows}/10</b> vœux estimés. ${balanceAdvice(cnt,vows)}</p>`+
   items.map(r=>`<div class="bk-row"><i class="dot" style="background:var(--c${r.ch.cat.k})" title="${r.ch.cat.l}"></i><span>${r.fil==="ING"?"":`<b>${r.fil}</b> `}${esc(r.etab)} <span class="hint" style="display:inline">${Math.round(r.d)} km</span></span><button type="button" class="x" data-rm="${r.id}" aria-label="Retirer ${esc(r.etab)}">×</button></div>`).join("")+
   `<p class="hint">Un concours commun (Geipi Polytech, Puissance Alpha, Avenir…) compte pour un seul vœu, ses écoles sont des sous-vœux. Règles à vérifier sur Parcoursup.</p>`;
}
function upd(keepLimit){
  if(!keepLimit){limit=60;flashId=null;}
  save();writeParams();renderScores();renderCoverage();
  const all=sortRows(filtered(),st.sort);
  $("count").textContent=all.length+" formation"+(all.length>1?"s":"");
  if(st.home) renderSvgMap($("map"),st.home,st.radius,all,st.basket); else $("map").innerHTML="";
  renderList(all);renderBasket();
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
  $("map").addEventListener("click",e=>{const c=e.target.closest("circle[data-id]");if(!c)return;const id=+c.dataset.id;flashId=id;
    const all=sortRows(filtered(),st.sort);const idx=all.findIndex(r=>r.id===id);if(idx>=limit)limit=idx+10;renderList(all);
    const el=document.getElementById("it-"+id);if(el)el.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"center"});});
  $("list").addEventListener("click",e=>{const b=e.target.closest("[data-add]");if(!b)return;const id=+b.dataset.add;
    st.basket=st.basket.includes(id)?st.basket.filter(x=>x!==id):[...st.basket,id];upd(true);});
  $("basket").addEventListener("click",e=>{const b=e.target.closest("[data-rm]");if(!b)return;st.basket=st.basket.filter(x=>x!==+b.dataset.rm);upd(true);});
}

// ---------- démarrage ----------
async function start(){
  try{
    const res=await fetch(CFG.fichierDonnees);
    if(!res.ok) throw new Error("HTTP "+res.status);
    const data=await res.json();META=data.meta||{};
    rows=data.rows.map(rowFromArray).filter(r=>W[r.fil]);
    if(META.session) $("h-session").textContent=META.session;
  }catch(e){
    $("list").innerHTML=`<div class="empty">Impossible de lire ${esc(CFG.fichierDonnees)} (${esc(e.message)}). Ouvrez l'outil via un petit serveur web, par exemple <code>python3 -m http.server</code>, pas en double-cliquant sur le fichier.</div>`;
    return;
  }
  const p=readParams();
  if(p.rayon) st.radius=p.rayon;
  if(p.fils) st.fils=p.fils;
  initControls();
  if(p.coords){st.home=p.coords;$("city").value=p.coords.name;upd();}
  else if(p.ville) await setCity(p.ville,true);
  else if(st.home){$("city").value=st.home.name;upd();}
  else await setCity(CFG.villeParDefaut,true);
}
start();
