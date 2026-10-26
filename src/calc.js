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
export const CH=[{k:1,l:"Sécurité",min:.70},{k:2,l:"Probable",min:.55},{k:3,l:"Possible",min:.40},{k:4,l:"Ambitieux",min:.25},{k:5,l:"Très ambitieux",min:-1}];
// Formation dont le profil des admis repose sur trop peu d'élèves pour situer le dossier.
export const NON_ESTIMABLE={k:0,l:"Non estimable"};
export const BANDS=[[18,20.01],[16,18],[14,16],[12,14],[0,12]];

export function dist(a,b,c,d){const R=6371,t=Math.PI/180,x=Math.sin((c-a)*t/2)**2+Math.cos(a*t)*Math.cos(c*t)*Math.sin((d-b)*t/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
export const norm=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[-'’\s]+/g," ").trim();

// el : {n:{m,pc,mx,s3,an,fr,au}, mxon, s3type, avis}
export function score(fil,el){
  const w=Object.assign({},W[fil]),n=el.n;
  if(!el.mxon) w.mx=0;
  if(S3BONUS[fil]&&el.s3type===S3BONUS[fil]) w.s3+=1;
  let s=0,t=0;for(const k in w){s+=w[k]*n[k];t+=w[k];}
  let v=s/t;
  if(!el.mxon&&(fil==="MPSI"||fil==="MP2I")) v-=.5;
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
export function chance(r,el,admisMin=15){
  const s=score(r.fil,el);
  if(!(r.admis>=admisMin)) return {s,p:null,c:null,cat:NON_ESTIMABLE};
  const p=position(s,r.mp);
  if(!p) return {s,p:null,c:null,cat:NON_ESTIMABLE};
  const c=0.65*p.pos+0.35*tauxRef(r)/100;
  return {s,p,c,cat:CH.find(z=>c>=z.min)};
}
// L'open data ne renseigne pas l'internat des écoles d'ingénieurs : on ne peut ni les garder ni les exclure à coup sûr.
export const internatInconnu=r=>r.internatCode==null;
// Taux d'accès des terminales générales (estimé par scripts/update_data.py), le taux officiel à défaut.
export const tauxRef=r=>r.tauxGen??r.taux;
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
  const f={chance:cmpC,dist:(x,y)=>x.d-y.d,sel:(x,y)=>tauxRef(x)-tauxRef(y),level:(x,y)=>(y.mp[0]+y.mp[1])-(x.mp[0]+x.mp[1])};
  return a.sort(f[by]||cmpC);
}
// Un vœu Parcoursup = une CPGE, ou un concours / réseau d'écoles
export function vowKey(r){
  if(r.fil!=="ING") return "c"+r.id;
  const m=r.det.match(/^(Concours [^·]+|Groupe INSA|Groupe ICAM|CESI|ECAM-ECAM LaSalle|UniLaSalle|La Prépa des INP)/);
  return m?m[1].trim():"e"+r.etab;
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
    aca:g(r,"pAcaOrig"),admis:g(r,"admis"),tauxHist:g(r,"tauxHist")||[],tauxGenHist:g(r,"tauxGenHist")||[],lien:g(r,"lien")}));
}
