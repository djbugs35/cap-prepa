/* Calculs de Cap Prépa : score de dossier, position parmi les admis, chances, filtres.
   Aucun accès au DOM ni au réseau, pour pouvoir être testé avec node --test (tests/calc.test.js). */

// Filières proposées. Public visé : terminale générale maths + physique-chimie (+ maths expertes).
export const FILS=[["MPSI","MPSI"],["MP2I","MP2I"],["PCSI","PCSI"],["PTSI","PTSI"],["BCPST","BCPST"],["ING","Écoles post-bac"]];
// Pondérations indicatives : maths, physique-chimie, maths expertes, spé abandonnée en 1re, anglais, français, autres matières
export const W={
  MPSI:{m:4,pc:3,mx:2,s3:.5,an:1,fr:1,au:1},
  MP2I:{m:4,pc:2,mx:2,s3:.5,an:1,fr:1,au:1},
  PCSI:{m:3,pc:4,mx:1,s3:.5,an:1,fr:1,au:1},
  PTSI:{m:3,pc:3,mx:1,s3:.5,an:1,fr:1,au:1},
  BCPST:{m:2.5,pc:3,mx:.5,s3:.5,an:1,fr:1.5,au:1.5},
  ING:{m:3,pc:2.5,mx:1,s3:.5,an:1.5,fr:1.5,au:1.5}
};
export const S3BONUS={MP2I:"NSI",PTSI:"SI",BCPST:"SVT"};
// Catégories de chances, de la plus sûre à la plus risquée ; leurs seuils sont dans REGLAGES.seuils.
export const CH=[{k:1,l:"Sécurité"},{k:2,l:"Probable"},{k:3,l:"Possible"},{k:4,l:"Ambitieux"},{k:5,l:"Très ambitieux"}];
// Formation dont le profil des admis repose sur trop peu d'élèves pour situer le dossier.
export const NON_ESTIMABLE={k:0,l:"Non estimable"};
export const BANDS=[[18,20.01],[16,18],[14,16],[12,14],[0,12]];

export function dist(a,b,c,d){const R=6371,t=Math.PI/180,x=Math.sin((c-a)*t/2)**2+Math.cos(a*t)*Math.cos(c*t)*Math.sin((d-b)*t/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
export const norm=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[-'’\s]+/g," ").trim();

// Réglages de l'estimation, remplaçables depuis config.js (voir reglagesDepuis).
// seuils : chance minimale de Sécurité, Probable, Possible, Ambitieux (en dessous : Très ambitieux).
export const REGLAGES={admisMinProfil:15,partPosition:.65,seuils:[.70,.55,.40,.25],ecartFourchette:.5,ecartTauxInstable:20,poids:W};
export function reglagesDepuis(cfg={}){
  const R={...REGLAGES};
  for(const k of ["admisMinProfil","partPosition","ecartFourchette","ecartTauxInstable"]) if(typeof cfg[k]==="number") R[k]=cfg[k];
  const s=cfg.seuilsChances;
  if(Array.isArray(s)&&s.length===4&&s.every((x,i)=>typeof x==="number"&&(!i||x<s[i-1]))) R.seuils=s;
  R.poids=Object.fromEntries(Object.entries(W).map(([f,w])=>[f,{...w,...((cfg.poidsMatieres||{})[f]||{})}]));
  return R;
}
// Sans maths expertes, MPSI et MP2I retirent en plus 0,5 : l'option y est quasi systématique chez les admis.
const MX_INDISPENSABLE=["MPSI","MP2I"];

// el : {n:{m,pc,mx,s3,an,fr,au}, mxon, s3type, avis}
export function score(fil,el,poids=W){
  const w=Object.assign({},poids[fil]),n=el.n;
  if(!el.mxon) w.mx=0;
  if(S3BONUS[fil]&&el.s3type===S3BONUS[fil]) w.s3+=1;
  let s=0,t=0;for(const k in w){s+=w[k]*n[k];t+=w[k];}
  let v=s/t;
  if(!el.mxon&&MX_INDISPENSABLE.includes(fil)) v-=.5;
  v+=el.avis==="TF"?.4:el.avis==="AF"?-.6:0;
  return Math.max(0,Math.min(20,v));
}
// mp : % d'admis par mention (TB félicitations, TB, B, AB, sans). Renvoie la part d'admis devant l'élève.
export function position(s,mp){
  const tot=mp.reduce((a,b)=>a+(b||0),0);if(!tot)return null;
  const p=mp.map(x=>(x||0)/tot*100);
  let k=BANDS.findIndex(b=>s>=b[0]&&s<b[1]);if(k<0)k=4;
  const [lo,hi]=BANDS[k];const frac=k===4?Math.max(0,(s-8)/4):(s-lo)/((k===0?20:hi)-lo);
  let above=0;for(let i=0;i<k;i++)above+=p[i];
  const x=above+(1-Math.min(1,Math.max(0,frac)))*p[k]; // % d'admis devant l'élève
  return {x:Math.max(0,Math.min(100,x)),pos:1-x/100};
}
const categorie=(c,seuils)=>CH[seuils.findIndex(m=>c>=m)]??CH[4];
export function chance(r,el,R=REGLAGES){
  const s=score(r.fil,el,R.poids);
  if(!(r.admis>=R.admisMinProfil)) return {s,p:null,c:null,cat:NON_ESTIMABLE};
  const p=position(s,r.mp);
  if(!p) return {s,p:null,c:null,cat:NON_ESTIMABLE};
  const c=R.partPosition*p.pos+(1-R.partPosition)*tauxLisse(r)/100;
  return {s,p,c,cat:categorie(c,R.seuils)};
}
// Toutes les notes décalées de d points, bornées à 0-20.
const decaler=(el,d)=>({...el,n:Object.fromEntries(Object.entries(el.n).map(([k,v])=>[k,Math.max(0,Math.min(20,v+d))]))});
/* Rend la chance, la fourchette obtenue en décalant les notes de ±R.ecartFourchette, l'instabilité du taux
   et les raisons à afficher. annees : sessions de l'historique (meta.sessionsHist), de la plus ancienne à la plus récente. */
export function estimation(r,el,R=REGLAGES,annees=[]){
  const ch=chance(r,el,R),bas=chance(r,decaler(el,-R.ecartFourchette),R).cat,haut=chance(r,decaler(el,R.ecartFourchette),R).cat;
  const est={...ch,bas,haut,instable:estInstable(r,R.ecartTauxInstable)};
  return {...est,raisons:raisons(r,el,est,annees)};
}
export const libelleFourchette=e=>e.bas.k===e.haut.k?e.cat.l:e.bas.l+" à "+e.haut.l.toLowerCase();
// Rend deux ou trois phrases qui expliquent l'estimation, la plus déterminante d'abord.
export function raisons(r,el,e,annees=[]){
  const out=[];
  if(!el.mxon&&MX_INDISPENSABLE.includes(r.fil)) out.push("Sans maths expertes, le dossier est pénalisé : presque tous les admis en "+r.fil+" suivent l'option.");
  if(e.p) out.push(`Dossier estimé au-dessus d'environ ${Math.round(e.p.pos*100)} % des admis.`);
  else out.push(`Trop peu d'admis (${r.admis??0}) pour situer le dossier.`);
  const t=tauxAnnuels(r),vals=t.filter(x=>x!=null);
  if(e.instable) out.push(`Taux d'accès instable (de ${Math.min(...vals)} % à ${Math.max(...vals)} % selon les années) : estimation fragile.`);
  else if(t[0]!=null&&annees.length&&Math.abs(tauxRef(r)-t[0])>=10)
    out.push(`Taux d'accès en ${tauxRef(r)<t[0]?"baisse":"hausse"} depuis ${annees[0]} (${t[0]} % puis ${tauxRef(r)} %).`);
  if(r.aca>=75){
    const m=el.academie&&r.academie?memeAcademie(el.academie,r.academie):null;
    out.push(`Recrute surtout dans son académie (${r.aca} % des admis)`+(m===true?" : c'est la vôtre, un atout.":m===false?` : ${r.academie}, pas la vôtre.`:"."));
  }
  return out.slice(0,3);
}
// L'open data ne renseigne pas l'internat des écoles d'ingénieurs : on ne peut ni les garder ni les exclure à coup sûr.
export const internatInconnu=r=>r.internatCode==null;
// Taux d'accès des terminales générales (estimé par scripts/update_data.py), le taux officiel à défaut.
export const tauxRef=r=>r.tauxGen??r.taux;
// Taux des sessions passées puis de la dernière, sur le même indicateur que tauxRef (null : année inconnue).
export const tauxAnnuels=r=>[...((r.tauxGen!=null?r.tauxGenHist:r.tauxHist)||[]),tauxRef(r)];
// Moyenne pondérée 1, 2, 3… de la plus ancienne à la plus récente : une seule année atypique ne décide plus de tout.
export function tauxLisse(r){
  let s=0,t=0;tauxAnnuels(r).forEach((x,i)=>{if(x!=null){s+=(i+1)*x;t+=i+1;}});
  return t?s/t:tauxRef(r);
}
export function estInstable(r,ecart=REGLAGES.ecartTauxInstable){
  const v=tauxAnnuels(r).filter(x=>x!=null);
  return v.length>=2&&Math.max(...v)-Math.min(...v)>=ecart;
}
// Filières de 2e année accessibles après chaque CPGE de 1re année (concours SCEI de fin de 2e année).
export const SUITES={MPSI:["MP","MPI","PSI"],MP2I:["MPI","MP"],PCSI:["PC","PSI"],PTSI:["PT","PSI"],BCPST:["BCPST"]};
// Rend [{filiere, url}] des statistiques SCEI des concours visés après la formation ; [] pour une école post-bac.
// modele : adresse avec {annee} et {filiere} (config.js, clé sceiStatistiques).
export function liensApresPrepa(fil,modele,annee){
  return (SUITES[fil]||[]).map(f=>({filiere:f,url:modele.replace("{annee}",annee).replace("{filiere}",f.toLowerCase())}));
}
// Rend [{annee, taux}] des sessions connues, de la plus ancienne à la plus récente. annees : meta.sessionsHist.
export function historiqueTaux(r,annees,session){
  const ans=[...annees,session];
  return tauxAnnuels(r).map((taux,i)=>({annee:ans[i],taux})).filter(h=>h.taux!=null&&h.annee!=null);
}
// Ajoute ou retire id de la comparaison ; au-delà de max formations, la plus ancienne sort.
export function basculerComparaison(ids,id,max=4){
  return ids.includes(id)?ids.filter(x=>x!==id):[...ids,id].slice(-max);
}
// Rend l'avertissement à afficher quand l'élève vise MPSI ou MP2I sans maths expertes, null sinon.
export function avertissementMathsExpertes(el,fils){
  const f=fils.filter(x=>MX_INDISPENSABLE.includes(x));
  return el.mxon||!f.length?null:`Sans maths expertes, les dossiers en ${f.join(" et ")} sont nettement moins compétitifs : l'option est suivie par presque tous les admis.`;
}
// Formations dans le rayon et les filtres. f : {home, radius, fils, pub, intern, q}
export function filterRows(rows,f){
  if(!f.home) return [];
  const q=norm(f.q);
  return rows.map(r=>Object.assign({d:dist(f.home.lat,f.home.lon,r.lat,r.lon)},r)).filter(r=>
    r.d<=f.radius&&f.fils.includes(r.fil)&&(!f.pub||r.pub)&&(!f.intern||r.intern||internatInconnu(r))&&
    (!q||norm(r.etab+" "+r.ville+" "+r.det+" "+r.fil).includes(q))
  );
}
// Les « non estimables » passent toujours après les autres dans le tri par chances.
export function sortRows(a,by){
  const cmpC=(x,y)=>(x.ch.c==null)-(y.ch.c==null)||(y.ch.c||0)-(x.ch.c||0)||x.d-y.d;
  // synthese : formations sans aucun classement en dernier (r.synth calculé par main.js, voir classements.js).
  const f={chance:cmpC,synthese:(x,y)=>(y.synth?.note??-1)-(x.synth?.note??-1)||x.d-y.d,dist:(x,y)=>x.d-y.d,sel:(x,y)=>tauxRef(x)-tauxRef(y),level:(x,y)=>(y.mp[0]+y.mp[1])-(x.mp[0]+x.mp[1])};
  return a.sort(f[by]||cmpC);
}
// Concours communs et réseaux d'écoles où chaque école est un sous-vœu d'un même vœu.
const RESEAUX=/^(Concours [^·]+|Groupe INSA|Groupe ICAM|CESI|ECAM-ECAM LaSalle|UniLaSalle|La Prépa des INP)/;
export const reseauDe=r=>{if(r.fil!=="ING")return null;const m=r.det.match(RESEAUX);return m?m[1].trim():null;};
// Un vœu Parcoursup = une CPGE, ou un concours / réseau d'écoles
export function vowKey(r){
  if(r.fil!=="ING") return "c"+r.id;
  return reseauDe(r)??"e"+r.etab;
}
// Rend les vœux de la liste dans l'ordre reçu : {cle, reseau (null hors concours ou réseau), formations}.
export function regrouperVoeux(items){
  const g=new Map();
  for(const r of items){const k=vowKey(r);if(!g.has(k))g.set(k,{cle:k,reseau:reseauDe(r),formations:[]});g.get(k).formations.push(r);}
  return [...g.values()];
}
const CLES_NOTES=["m","pc","mx","s3","an","fr","au"],AVIS=["TF","F","AF"],INTERNATS=["avec","sans","deux"];
/* Rend le fragment d'adresse (#…) qui décrit la liste, les notes et les choix d'internat.
   Un fragment n'est jamais envoyé au serveur : les notes de l'élève restent entre ceux qui ont le lien. */
export function encoderPartage({basket,n,mxon,s3type,avis,internats={}}){
  const p=new URLSearchParams({liste:basket.join(","),notes:CLES_NOTES.map(k=>n[k]).join(","),mx:mxon?"1":"0",s3:s3type,avis});
  const i=Object.entries(internats).filter(([id])=>basket.includes(+id)).map(([id,v])=>id+":"+v).join(",");
  if(i) p.set("internat",i);
  return "#"+p.toString();
}
// Rend l'état décrit par un fragment d'encoderPartage, sans les valeurs invalides ; null si le fragment n'en vient pas.
export function decoderPartage(hash){
  const p=new URLSearchParams(String(hash||"").replace(/^#/,""));
  if(!p.has("liste")) return null;
  const out={basket:p.get("liste").split(",").map(Number).filter(x=>Number.isInteger(x)&&x>0)};
  const notes=(p.get("notes")||"").split(",").map(Number);
  if(notes.length===CLES_NOTES.length&&notes.every(x=>x>=0&&x<=20)) out.n=Object.fromEntries(CLES_NOTES.map((k,i)=>[k,notes[i]]));
  if(p.has("mx")) out.mxon=p.get("mx")==="1";
  if(p.get("s3")) out.s3type=p.get("s3");
  if(AVIS.includes(p.get("avis"))) out.avis=p.get("avis");
  out.internats=Object.fromEntries((p.get("internat")||"").split(",").map(x=>x.split(":")).filter(([id,v])=>+id>0&&INTERNATS.includes(v)));
  return out;
}
export function balanceAdvice(cnt,vows){
  const safe=cnt[1]+cnt[2],amb=cnt[4]+cnt[5];
  let adv;
  if(safe===0) adv="Aucun vœu « sécurité » ou « probable » : ajoutez au moins deux formations où le dossier se situe bien dans le profil des admis.";
  else if(safe<2) adv="Un seul vœu sûr. Deux ou trois, c'est plus prudent.";
  else if(amb===0) adv="Liste prudente. Il y a de la place pour un ou deux vœux ambitieux.";
  else adv="Liste équilibrée entre ambition et sécurité.";
  if(vows>10) adv+=" Attention : plus de 10 vœux, le maximum Parcoursup.";
  return adv;
}
// Lignes compactes de data/formations.json -> objets, d'après meta.fields : l'ordre des colonnes peut changer.
export function rowsFromData(data){
  const F=data.meta.fields,ix=Object.fromEntries(F.map((f,i)=>[f,i]));
  const g=(r,f)=>ix[f]==null?null:r[ix[f]];
  return data.rows.map(r=>({id:g(r,"id"),etab:g(r,"etab"),ville:g(r,"ville"),dep:g(r,"dep"),lat:g(r,"lat"),lon:g(r,"lon"),
    fil:g(r,"filiere"),det:g(r,"detail")||"",pub:g(r,"public")===1,capa:g(r,"capa"),voeux:g(r,"voeux"),
    taux:g(r,"taux"),tauxGen:g(r,"tauxGen"),rang:g(r,"rangDernier"),cla:g(r,"classes"),
    mp:["pTBF","pTB","pB","pAB","pSans"].map(f=>g(r,f)),bours:g(r,"pBours"),fem:g(r,"pF"),
    internatCode:g(r,"internat"),intern:g(r,"internat")===1||g(r,"internat")===2,filles:g(r,"internat")===2,
    aca:g(r,"pAcaOrig"),admis:g(r,"admis"),tauxHist:g(r,"tauxHist")||[],tauxGenHist:g(r,"tauxGenHist")||[],lien:g(r,"lien"),academie:g(r,"academie"),
    insEmploi:g(r,"insEmploi"),insSalaire:g(r,"insSalaire"),insPromo:g(r,"insPromo"),uai:g(r,"uai")}));
}
// Paris, Créteil et Versailles : Parcoursup traite souvent l'Île-de-France comme un seul secteur de recrutement.
const ILE_DE_FRANCE=["paris","creteil","versailles"];
// Les deux sources écrivent « Besancon » et « Besançon », « Nouvelle-Calédonie » et « Nouvelle Calédonie » : on compare sans accents ni tirets.
export function memeAcademie(a,b){
  const x=norm(a),y=norm(b);
  return x===y||(ILE_DE_FRANCE.includes(x)&&ILE_DE_FRANCE.includes(y));
}
// Lignes compactes de data/lycees.json -> objets, avec une clé de recherche normalisée (nom et commune).
export function lyceesFromData(data){
  const F=data.meta.fields,ix=Object.fromEntries(F.map((f,i)=>[f,i]));
  return data.rows.map(r=>{const g=f=>ix[f]==null?null:r[ix[f]];
    return {uai:g("uai"),nom:g("nom"),commune:g("commune"),dep:g("dep"),academie:g("academie"),lat:g("lat"),lon:g("lon"),pub:g("public")===1,
      cle:norm(g("nom")+" "+g("commune"))};});
}
// Abréviations courantes dans les noms tapés (« st joseph ») : l'annuaire écrit toujours le mot entier.
const ABREVIATIONS={st:"saint",ste:"sainte"};
// Mots sans pouvoir de tri : « lycée » manque à certains noms (« Agricampus de Laval »), les autres sont partout.
const MOTS_VIDES=new Set(["lycee","de","du","des","la","le","les","au","aux","en","et","sur"]);
// Rend au plus max lycées dont le nom ou la commune contient tous les mots de q (sans accents ni casse).
export function chercherLycees(lycees,q,max=8){
  const mots=norm(q).split(" ").map(m=>ABREVIATIONS[m]||m).filter(m=>m.length>1&&!MOTS_VIDES.has(m));
  if(!mots.length) return [];
  return lycees.filter(l=>mots.every(m=>l.cle.includes(m))).slice(0,max);
}
