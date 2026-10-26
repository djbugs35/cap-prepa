/* Cap Prépa — aide aux vœux Parcoursup (CPGE scientifiques et écoles d'ingénieurs post-bac).
   Données : data/formations.json, produit par scripts/update_data.py à partir de l'open data Parcoursup.
   Paramètres d'adresse : ?ville=Rennes&rayon=150&filieres=MPSI,PCSI  (ou ?lat=48.11&lon=-1.68) */
(function () {
"use strict";
const CFG = Object.assign({
  villeParDefaut: "Rennes", rayonParDefaut: 150,
  filieresParDefaut: ["MPSI", "MP2I", "PCSI", "PTSI", "ING"],
  fichierDonnees: "data/formations.json", geoApi: "https://geo.api.gouv.fr/communes"
}, window.CAP_PREPA_CONFIG || {});

// Villes de repère sur la carte, et repli si le géocodage en ligne ne répond pas.
const CITIES = {
  "Paris":[48.857,2.352],"Marseille":[43.296,5.37],"Lyon":[45.764,4.836],"Toulouse":[43.605,1.444],"Nice":[43.71,7.262],
  "Nantes":[47.218,-1.554],"Montpellier":[43.611,3.877],"Strasbourg":[48.573,7.752],"Bordeaux":[44.838,-0.579],"Lille":[50.629,3.057],
  "Rennes":[48.111,-1.68],"Reims":[49.258,4.032],"Toulon":[43.124,5.928],"Saint-Étienne":[45.44,4.387],"Le Havre":[49.494,0.108],
  "Grenoble":[45.188,5.725],"Dijon":[47.322,5.041],"Angers":[47.478,-0.563],"Nîmes":[43.837,4.36],"Clermont-Ferrand":[45.778,3.087],
  "Le Mans":[48.0,0.2],"Aix-en-Provence":[43.53,5.447],"Brest":[48.39,-4.486],"Tours":[47.394,0.684],"Amiens":[49.894,2.296],
  "Limoges":[45.833,1.262],"Metz":[49.12,6.176],"Besançon":[47.238,6.024],"Perpignan":[42.699,2.895],"Orléans":[47.903,1.909],
  "Rouen":[49.443,1.1],"Caen":[49.183,-0.371],"Mulhouse":[47.75,7.336],"Nancy":[48.692,6.184],"Poitiers":[46.58,0.34],
  "Pau":[43.296,-0.37],"La Rochelle":[46.16,-1.15],"Vannes":[47.658,-2.76],"Lorient":[47.748,-3.37],"Quimper":[47.996,-4.102],
  "Saint-Brieuc":[48.514,-2.765],"Saint-Malo":[48.649,-2.026],"Laval":[48.073,-0.77],"Cherbourg":[49.64,-1.62],"Bayonne":[43.493,-1.475],
  "Troyes":[48.297,4.074],"Avignon":[43.949,4.806],"Valence":[44.933,4.892],"Chambéry":[45.564,5.918],"Annecy":[45.899,6.129]
};
const FILS=[["MPSI","MPSI"],["MP2I","MP2I"],["PCSI","PCSI"],["PTSI","PTSI"],["BCPST","BCPST"],["ING","Écoles post-bac"],["TSI","TSI"],["TB","TB"],["TPC","TPC"]];
// Pondérations indicatives : maths, physique-chimie, maths expertes, spé abandonnée en 1re, anglais, français, autres matières
const W={
  MPSI:{m:4,pc:3,mx:2,s3:.5,an:1,fr:1,au:1},
  MP2I:{m:4,pc:2,mx:2,s3:.5,an:1,fr:1,au:1},
  PCSI:{m:3,pc:4,mx:1,s3:.5,an:1,fr:1,au:1},
  PTSI:{m:3,pc:3,mx:1,s3:.5,an:1,fr:1,au:1},
  BCPST:{m:2.5,pc:3,mx:.5,s3:.5,an:1,fr:1.5,au:1.5},
  TSI:{m:3,pc:3,mx:0,s3:1,an:1,fr:1,au:1},
  TB:{m:2.5,pc:3,mx:0,s3:1.5,an:1,fr:1,au:1},
  TPC:{m:3,pc:3.5,mx:0,s3:1,an:1,fr:1,au:1},
  ING:{m:3,pc:2.5,mx:1,s3:.5,an:1.5,fr:1.5,au:1.5}
};
const S3BONUS={MP2I:"NSI",PTSI:"SI",BCPST:"SVT"};
const NOTES=[["m","Maths (spécialité)"],["pc","Physique-chimie (spécialité)"],["mx","Maths expertes"],["s3","Spécialité abandonnée en 1re"],["an","Anglais"],["fr","Français (épreuves anticipées)"],["au","Moyenne des autres matières"]];
const CH=[{k:1,l:"Sécurité",min:.70},{k:2,l:"Probable",min:.55},{k:3,l:"Possible",min:.40},{k:4,l:"Ambitieux",min:.25},{k:5,l:"Très ambitieux",min:-1}];
const MCOL=["var(--m1)","var(--m2)","var(--m3)","var(--m4)","var(--m5)"];
const MLAB=["TB félicitations","TB","B","AB","Sans mention"];
const BANDS=[[18,20.01],[16,18],[14,16],[12,14],[0,12]];

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=x=>(Math.round(x*10)/10).toFixed(1).replace(".",",");
function dist(a,b,c,d){const R=6371,t=Math.PI/180,x=Math.sin((c-a)*t/2)**2+Math.cos(a*t)*Math.cos(c*t)*Math.sin((d-b)*t/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
const norm=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[-'’\s]+/g," ").trim();

// ---------- état ----------
const DEF={home:null,radius:CFG.rayonParDefaut,fils:CFG.filieresParDefaut.slice(),pub:false,intern:false,
  n:{m:15,pc:14,mx:14,s3:14,an:14,fr:13,au:13},mxon:true,s3type:"SVT",avis:"F",sort:"chance",q:"",basket:[]};
let st=JSON.parse(JSON.stringify(DEF));
try{const s=localStorage.getItem("capprepa");if(s){const o=JSON.parse(s);st=Object.assign(st,o);st.n=Object.assign({},DEF.n,o.n||{});}}catch(e){}
function save(){try{localStorage.setItem("capprepa",JSON.stringify(st));}catch(e){}}

let rows=[], META={};
let limit=60, flashId=null;

// ---------- ville ----------
async function geocode(name){
  const key=norm(name);
  const local=Object.keys(CITIES).find(c=>norm(c)===key);
  try{
    const url=CFG.geoApi+"?nom="+encodeURIComponent(name)+"&fields=nom,centre,codeDepartement&boost=population&limit=5";
    const r=await fetch(url);if(!r.ok)throw new Error(r.status);
    const list=await r.json();
    const hit=list.find(c=>norm(c.nom)===key)||list[0];
    if(hit&&hit.centre) return {name:hit.nom,dep:hit.codeDepartement,lat:hit.centre.coordinates[1],lon:hit.centre.coordinates[0]};
  }catch(e){}
  if(local) return {name:local,lat:CITIES[local][0],lon:CITIES[local][1]};
  return null;
}
async function suggest(q){
  if(q.length<2)return;
  try{
    const r=await fetch(CFG.geoApi+"?nom="+encodeURIComponent(q)+"&fields=nom,codeDepartement&boost=population&limit=8");
    const list=await r.json();
    $("city-list").innerHTML=list.map(c=>`<option value="${esc(c.nom)}">${esc(c.nom)} (${esc(c.codeDepartement)})</option>`).join("");
  }catch(e){}
}
async function setCity(name,quiet){
  $("city-msg").textContent="Recherche de « "+name+" »…";
  const c=await geocode(name);
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

// ---------- calcul ----------
function score(fil){
  const w=Object.assign({},W[fil]),n=st.n;
  if(!st.mxon) w.mx=0;
  if(S3BONUS[fil]&&st.s3type===S3BONUS[fil]) w.s3+=1;
  let s=0,t=0;for(const k in w){s+=w[k]*n[k];t+=w[k];}
  let v=s/t;
  if(!st.mxon&&(fil==="MPSI"||fil==="MP2I")) v-=.5;
  v+=st.avis==="TF"?.4:st.avis==="AF"?-.6:0;
  return Math.max(0,Math.min(20,v));
}
function position(s,mp){
  const tot=mp.reduce((a,b)=>a+b,0);if(tot<50)return null;
  const p=mp.map(x=>x/tot*100);
  let k=BANDS.findIndex(b=>s>=b[0]&&s<b[1]);if(k<0)k=4;
  const [lo,hi]=BANDS[k];const frac=k===4?Math.max(0,(s-8)/4):(s-lo)/((k===0?20:hi)-lo);
  let above=0;for(let i=0;i<k;i++)above+=p[i];
  const x=above+(1-Math.min(1,Math.max(0,frac)))*p[k]; // % d'admis devant l'élève
  return {x:Math.max(0,Math.min(100,x)),pos:1-x/100};
}
function chance(r){
  const s=score(r.fil),p=position(s,r.mp);
  const c=p?0.65*p.pos+0.35*r.taux/100:r.taux/100*0.8;
  return {s,p,c,cat:CH.find(z=>c>=z.min)};
}
function filtered(){
  if(!st.home) return [];
  const q=st.q.trim().toLowerCase();
  return rows.map(r=>Object.assign({d:dist(st.home.lat,st.home.lon,r.lat,r.lon)},r)).filter(r=>
    r.d<=st.radius&&st.fils.includes(r.fil)&&(!st.pub||r.pub)&&(!st.intern||r.intern||r.fil==="ING")&&
    (!q||(r.etab+" "+r.ville+" "+r.det+" "+r.fil).toLowerCase().includes(q))
  ).map(r=>Object.assign(r,{ch:chance(r)}));
}
function sortRows(a){
  const by={chance:(x,y)=>y.ch.c-x.ch.c||x.d-y.d,dist:(x,y)=>x.d-y.d,sel:(x,y)=>x.taux-y.taux,level:(x,y)=>(y.mp[0]+y.mp[1])-(x.mp[0]+x.mp[1])};
  return a.sort(by[st.sort]||by.chance);
}

// ---------- rendu ----------
function renderScores(){
  const fs=FILS.map(f=>f[0]).filter(f=>st.fils.includes(f));
  $("scores").innerHTML=fs.length?fs.map(f=>{const s=score(f);
    return `<span>${f==="ING"?"Écoles":f}</span><span class="bar"><i style="width:${Math.max(0,(s-6)/14*100)}%"></i></span><span class="mono">${fmt(s)}</span>`;}).join("")
    :`<span class="hint" style="grid-column:1/-1">Choisissez au moins une filière.</span>`;
  NOTES.forEach(([k])=>{$("o-"+k).textContent=fmt(st.n[k]);});
  $("n-mx").disabled=!st.mxon;
  $("radius-o").textContent=st.radius+" km";
  $("h-city").textContent=st.home?st.home.name:"";
  document.title="Cap Prépa"+(st.home?" · "+st.home.name:"");
}
function renderCoverage(){
  const cov=META.coverage, el=$("coverage");
  if(!cov||!st.home){el.hidden=true;return;}
  const d=dist(st.home.lat,st.home.lon,cov.center[0],cov.center[1]);
  if(d+st.radius<=cov.radiusKm){el.hidden=true;return;}
  el.hidden=false;
  el.innerHTML=`<b>Données partielles pour cette zone.</b>Le fichier de données ne couvre que : ${esc(cov.label)}. Pour toute la France, lancez <code>python3 scripts/update_data.py</code> (voir le README).`;
}
function renderMap(list){
  const svg=$("map");const hl=st.home.lat,ho=st.home.lon;
  const W2=640,H2=400,pad=24,kx=Math.cos(hl*Math.PI/180),km=111.2;
  const sc=(H2/2-pad)/Math.max(st.radius,50),cx=W2/2,cy=H2/2;
  const P=(la,lo)=>[cx+(lo-ho)*kx*km*sc,cy-(la-hl)*km*sc];
  let g="";
  const steps=[25,50,100,150,200,300,400,500].filter(v=>v<st.radius);
  const rings=[...steps.slice(-3),st.radius];
  rings.forEach((r,i)=>{const rr=r*sc,last=i===rings.length-1;
    g+=`<circle cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="var(--line)" stroke-width="${last?1.5:1}" ${last?"":'stroke-dasharray="3 4"'}/>`;
    g+=`<text x="${cx+rr*0.707+3}" y="${cy-rr*0.707-3}" font-size="10" fill="var(--muted)">${r} km</text>`;});
  Object.entries(CITIES).forEach(([n,[la,lo]])=>{const [x,y]=P(la,lo);if(x<6||x>W2-60||y<10||y>H2-4)return;
    const d=dist(hl,ho,la,lo);if(d>st.radius*1.25||d<st.radius*0.06)return;
    g+=`<circle cx="${x}" cy="${y}" r="1.6" fill="var(--muted)"/><text x="${x+4}" y="${y-4}" font-size="10.5" fill="var(--muted)">${esc(n)}</text>`;});
  const groups={};list.forEach(r=>{const key=r.lat.toFixed(2)+","+r.lon.toFixed(2);(groups[key]=groups[key]||[]).push(r);});
  Object.values(groups).forEach(gr=>{gr.sort((a,b)=>a.ch.c-b.ch.c);
    gr.forEach((r,i)=>{let [x,y]=P(r.lat,r.lon);const a=i*2.4;if(i){x+=Math.cos(a)*3.2*Math.sqrt(i);y+=Math.sin(a)*3.2*Math.sqrt(i);}
      const inB=st.basket.includes(r.id);
      g+=`<circle data-id="${r.id}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${inB?5.5:4.2}" fill="var(--c${r.ch.cat.k})" stroke="${inB?"var(--ink)":"var(--card)"}" stroke-width="${inB?2:1}" style="cursor:pointer"><title>${esc(r.etab)} · ${r.fil==="ING"?"École":r.fil} · ${r.ch.cat.l}</title></circle>`;});});
  g+=`<path d="M${cx-6},${cy} L${cx+6},${cy} M${cx},${cy-6} L${cx},${cy+6}" stroke="var(--marge)" stroke-width="2.5"/><text x="${cx+8}" y="${cy+14}" font-size="11.5" font-weight="700" fill="var(--marge)">${esc(st.home.name)}</text>`;
  svg.innerHTML=g;
}
function mbar(r){
  const tot=r.mp.reduce((a,b)=>a+b,0);
  if(tot<50) return `<div class="msub">Profil des admis non publié (trop peu d'admis)</div>`;
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
    h+=`<div class="item${flashId===r.id?" flash":""}" id="it-${r.id}">
      <span class="c-ch"><span class="pill k${r.ch.cat.k}">${r.ch.cat.l}</span></span>
      <span class="c-n name"><span class="badge${r.pub?"":" priv"}">${r.fil==="ING"?"École":r.fil}</span>${esc(r.etab)}<small>${esc(r.ville)} · ${Math.round(r.d)} km${r.det?" · "+esc(r.det):""}${r.pub?"":" · privé"}${r.intern?" · internat":""}</small></span>
      <span class="c-t num">${r.taux} %${tr}</span>
      <span class="c-m">${mbar(r)}</span>
      <span class="c-d num">${r.aca} %<small>${r.capa} places · ${r.voeux.toLocaleString("fr-FR")} vœux</small></span>
      <span class="c-a acts"><button type="button" class="btn${inB?" on":""}" data-add="${r.id}">${inB?"Dans la liste":"Ajouter"}</button><a class="btn ghost" href="${linkFor(r.id)}" target="_blank" rel="noopener">Fiche</a></span>
    </div>`;});
  if(all.length>limit) h+=`<div class="more"><button type="button" class="btn" id="more">Afficher ${Math.min(60,all.length-limit)} de plus (${all.length-limit} restantes)</button></div>`;
  $("list").innerHTML=h;
  const m=$("more");if(m)m.onclick=()=>{limit+=60;renderList(all);};
}
function vowKey(r){ // un vœu Parcoursup = une CPGE, ou un concours / réseau d'écoles
  if(r.fil!=="ING") return "c"+r.id;
  const m=r.det.match(/^(Concours [^·]+|Groupe INSA|Groupe ICAM|CESI|ECAM-ECAM LaSalle|UniLaSalle|La Prépa des INP)/);
  return m?m[1].trim():"e"+r.etab;
}
function renderBasket(){
  const items=st.basket.map(id=>rows.find(r=>r.id===id)).filter(Boolean)
    .map(r=>Object.assign({d:st.home?dist(st.home.lat,st.home.lon,r.lat,r.lon):0},r)).map(r=>Object.assign(r,{ch:chance(r)})).sort((a,b)=>b.ch.c-a.ch.c);
  if(!items.length){$("basket").innerHTML=`<p class="hint">Cliquez sur « Ajouter » pour construire une liste et vérifier qu'elle est équilibrée.</p>`;return;}
  const cnt=[0,0,0,0,0,0];items.forEach(r=>cnt[r.ch.cat.k]++);
  const vows=new Set(items.map(vowKey)).size,safe=cnt[1]+cnt[2],amb=cnt[4]+cnt[5];
  let adv;
  if(safe===0) adv="Aucun vœu « sécurité » ou « probable » : ajoutez au moins deux formations où le dossier se situe bien dans le profil des admis.";
  else if(safe<2) adv="Un seul vœu sûr. Deux ou trois, c'est plus prudent.";
  else if(amb===0) adv="Liste prudente. Il y a de la place pour un ou deux vœux ambitieux.";
  else adv="Liste équilibrée entre ambition et sécurité.";
  if(vows>10) adv+=" Attention : plus de 10 vœux, le maximum Parcoursup.";
  $("basket").innerHTML=`<div class="balance">${[1,2,3,4,5].map(k=>cnt[k]?`<i style="width:${cnt[k]/items.length*100}%;background:var(--c${k})" title="${CH[k-1].l} : ${cnt[k]}"></i>`:"").join("")}</div>
   <p class="advice"><b class="mono">${vows}/10</b> vœux estimés. ${adv}</p>`+
   items.map(r=>`<div class="bk-row"><i class="dot" style="background:var(--c${r.ch.cat.k})" title="${r.ch.cat.l}"></i><span>${r.fil==="ING"?"":`<b>${r.fil}</b> `}${esc(r.etab)} <span class="hint" style="display:inline">${Math.round(r.d)} km</span></span><button type="button" class="x" data-rm="${r.id}" aria-label="Retirer ${esc(r.etab)}">×</button></div>`).join("")+
   `<p class="hint">Un concours commun (Geipi Polytech, Puissance Alpha, Avenir…) compte pour un seul vœu, ses écoles sont des sous-vœux. Règles à vérifier sur Parcoursup.</p>`;
}
function upd(keepLimit){
  if(!keepLimit){limit=60;flashId=null;}
  save();writeParams();renderScores();renderCoverage();
  const all=sortRows(filtered());
  $("count").textContent=all.length+" formation"+(all.length>1?"s":"");
  if(st.home) renderMap(all); else $("map").innerHTML="";
  renderList(all);renderBasket();
}

// ---------- contrôles ----------
function initControls(){
  let t=null;
  $("city").oninput=e=>{clearTimeout(t);t=setTimeout(()=>suggest(e.target.value.trim()),250);};
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
  $("legend").innerHTML=CH.map(c=>`<span><i class="dot" style="background:var(--c${c.k})"></i>${c.l}</span>`).join("");
  $("map").addEventListener("click",e=>{const c=e.target.closest("circle[data-id]");if(!c)return;const id=+c.dataset.id;flashId=id;
    const all=sortRows(filtered());const idx=all.findIndex(r=>r.id===id);if(idx>=limit)limit=idx+10;renderList(all);
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
    rows=data.rows.map(r=>({id:r[0],etab:r[1],ville:r[2],dep:r[3],lat:r[4],lon:r[5],fil:r[6],det:r[7]||"",pub:r[8]===1,capa:r[9],voeux:r[10],taux:r[11],rang:r[12],cla:r[13],mp:[r[14],r[15],r[16],r[17],r[18]],bours:r[19],fem:r[20],intern:r[21]===1,aca:r[22],admis:r[23],t24:r[24]}));
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
})();
