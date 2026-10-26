/* Classements : indicateurs open data et classements personnels importés, ramenés à un rang centile
   puis combinés en une note de synthèse /20. Aucun accès au DOM : testé par tests/classements.test.js. */
import {tauxRef} from "./calc.js";

const partTB=r=>{const t=r.mp.reduce((a,b)=>a+(b||0),0);return t?Math.round(((r.mp[0]||0)+(r.mp[1]||0))/t*100):null;};
const nbFr=v=>v.toLocaleString("fr-FR");
/* sens : 1 si une valeur plus haute est meilleure, -1 sinon. Les classements de presse ne sont pas sous licence
   ouverte : on ne les recopie pas, l'utilisateur peut importer les siens (lireCsvClassements). */
export const CLASSEMENTS_INTEGRES=[
  {id:"niveau",nom:"Niveau des admis (part de mentions TB)",court:"Niveau",valeur:partTB,sens:1,format:v=>v+" % TB"},
  {id:"selectivite",nom:"Sélectivité (taux d'accès)",court:"Sélectivité",valeur:r=>tauxRef(r),sens:-1,format:v=>"accès "+v+" %"},
  {id:"attractivite",nom:"Attractivité (vœux par place)",court:"Attractivité",valeur:r=>r.capa>0&&r.voeux!=null?Math.round(r.voeux/r.capa*10)/10:null,sens:1,format:v=>nbFr(v)+" vœux/place"},
  {id:"emploi",nom:"Emploi salarié à 18 mois (InserSup)",court:"Emploi",valeur:r=>r.insEmploi??null,sens:1,format:v=>v+" % en emploi"},
  {id:"salaire",nom:"Salaire net médian à 18 mois (InserSup)",court:"Salaire",valeur:r=>r.insSalaire??null,sens:1,format:v=>nbFr(v)+" €/mois"},
];
export const PREFIXE_PERSO="perso:";
// Classement importé {nom, rangs: {id formation: rang}} : un rang plus petit est meilleur.
export const classementPerso=c=>({id:PREFIXE_PERSO+c.nom,nom:c.nom,court:c.nom,perso:true,valeur:r=>c.rangs[r.id]??null,sens:-1,format:v=>v+(v===1?"er":"e")});

// Une CPGE et une école post-bac ne se comparent pas : rangs calculés dans chaque famille.
const famille=r=>r.fil==="ING"?"ING":"CPGE";
/* Rend id formation -> {id classement: {valeur, centile}}. centile : 1 pour la meilleure formation de sa famille,
   0 pour la moins bonne, ex aequo au milieu ; null quand moins de deux formations de la famille ont une valeur. */
export function calculerCentiles(rows,classements){
  const out=new Map(rows.map(r=>[r.id,{}]));
  for(const c of classements) for(const fam of ["CPGE","ING"]){
    const vals=rows.filter(r=>famille(r)===fam).map(r=>[r.id,c.valeur(r)]).filter(([,v])=>Number.isFinite(v));
    const tri=vals.map(([,v])=>v*c.sens).sort((a,b)=>a-b),n=tri.length;
    for(const [id,v] of vals){
      const x=v*c.sens,moins=tri.indexOf(x),egaux=tri.lastIndexOf(x)-moins+1;
      out.get(id)[c.id]={valeur:v,centile:n<2?null:(moins+(egaux-1)/2)/(n-1)};
    }
  }
  return out;
}
/* Rend {note /20 au dixième, n classements pris en compte}, ou null sans aucun classement.
   poids : {id: poids} (config.js, poidsClassements) ; les classements importés partagent la clé « perso ». */
export function noteSynthese(scores,poids={}){
  let s=0,t=0,n=0;
  for(const [id,x] of Object.entries(scores||{})){
    const w=poids[id.startsWith(PREFIXE_PERSO)?"perso":id]??1;
    if(x.centile==null||!w) continue;
    s+=w*x.centile;t+=w;n++;
  }
  return t?{note:Math.round(s/t*200)/10,n}:null;
}
// « mieux que 88 % » : se lit dans les deux sens, là où « top 85 % » semblait flatteur pour une formation mal placée.
export const libelleRang=centile=>"mieux que "+Math.round(centile*100)+" %";

// Découpe une ligne CSV, guillemets doubles et "" échappés compris.
function cellules(ligne,sep){
  const out=[];let cur="",guillemets=false;
  for(let i=0;i<ligne.length;i++){const c=ligne[i];
    if(guillemets){if(c==='"'&&ligne[i+1]==='"'){cur+='"';i++;}else if(c==='"')guillemets=false;else cur+=c;}
    else if(c==='"')guillemets=true;else if(c===sep){out.push(cur.trim());cur="";}else cur+=c;}
  out.push(cur.trim());return out;
}
const COLONNES_INFO=["id","etablissement","ville","filiere"];
/* Rend [{nom, rangs}] d'un CSV : colonne « id » (identifiant Parcoursup, comme dans le modèle), puis une colonne
   par classement, rangs entiers (« 12 », « 12e » acceptés). Séparateur ; , ou tabulation détecté sur l'en-tête.
   Raises: Error si la colonne id manque. */
export function lireCsvClassements(texte){
  const lignes=String(texte).replace(/^﻿/,"").split(/\r?\n/).filter(l=>l.trim());
  if(!lignes.length) return [];
  const sep=[";","\t",","].find(s=>lignes[0].includes(s))||";",entete=cellules(lignes[0],sep);
  const iId=entete.findIndex(h=>h.toLowerCase()==="id");
  if(iId<0) throw new Error("colonne « id » absente : partez du modèle téléchargé");
  const colonnes=entete.map((h,i)=>[h,i]).filter(([h])=>h&&!COLONNES_INFO.includes(h.toLowerCase()));
  const classements=colonnes.map(([nom])=>({nom,rangs:{}}));
  for(const l of lignes.slice(1)){
    const c=cellules(l,sep),id=parseInt(c[iId],10);
    if(!Number.isInteger(id)) continue;
    colonnes.forEach(([,i],k)=>{const rang=parseInt(c[i],10);if(rang>0)classements[k].rangs[id]=rang;});
  }
  return classements.filter(c=>Object.keys(c.rangs).length);
}
const champCsv=v=>/[";\n]/.test(String(v??""))?`"${String(v).replace(/"/g,'""')}"`:String(v??"");
// Rend le modèle CSV à remplir : une ligne par formation, une colonne vide par classement à saisir.
export function csvModele(rows,nomsClassements=["Mon classement"]){
  const entete=[...COLONNES_INFO,...nomsClassements].join(";");
  return "﻿"+[entete,...rows.map(r=>[r.id,r.etab,r.ville,r.fil,...nomsClassements.map(()=>"")].map(champCsv).join(";"))].join("\n")+"\n";
}
/* Rend [{id, nom, court, texte, centile, note, poids}] des classements où la formation figure, dans l'ordre de
   classements. note : le centile ramené sur 20 (null sans rang) ; poids : celui de noteSynthese. */
export function detailClassements(scores,classements,poids={}){
  return classements.filter(c=>scores&&scores[c.id]).map(c=>{const x=scores[c.id];
    return {id:c.id,nom:c.nom,court:c.court,centile:x.centile,texte:c.format(x.valeur)+(x.centile==null?"":" · "+libelleRang(x.centile)),
      note:x.centile==null?null:Math.round(x.centile*200)/10,poids:poids[c.perso?"perso":c.id]??1};});
}
