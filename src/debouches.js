/* Débouchés des prépas : écoles intégrées, saisies par l'utilisateur (aucune source ouverte ne les publie par lycée
   depuis 2021). Aucun accès au DOM : testé par tests/debouches.test.js. */
import {lireCsv,champCsv,COLONNES_INFO} from "./classements.js";

const COLONNES=[...COLONNES_INFO,"ecole","integres"];

/* Rend {id prépa: [{ecole, integres}]} d'un CSV au format du modèle : une ligne par prépa et par école.
   Une même école répétée pour une prépa est additionnée (plusieurs années saisies, par exemple).
   Raises: Error si les colonnes id, ecole ou integres manquent. */
export function lireCsvDebouches(texte){
  const {entete,lignes}=lireCsv(texte);
  const ix=Object.fromEntries(entete.map((h,i)=>[h.toLowerCase(),i]));
  const manquantes=["id","ecole","integres"].filter(c=>ix[c]==null);
  if(manquantes.length) throw new Error("colonnes absentes : "+manquantes.join(", ")+" (partez du modèle téléchargé)");
  const out={};
  for(const c of lignes){
    const id=parseInt(c[ix.id],10),ecole=(c[ix.ecole]||"").trim(),n=parseInt(c[ix.integres],10);
    if(!Number.isInteger(id)||!ecole||!(n>0)) continue;
    const liste=out[id]??=[],deja=liste.find(e=>e.ecole.toLowerCase()===ecole.toLowerCase());
    if(deja) deja.integres+=n; else liste.push({ecole,integres:n});
  }
  return out;
}
// Rend le modèle CSV : une ligne par prépa affichée, à dupliquer pour chaque école intégrée.
export function csvModeleDebouches(rows){
  const prepas=rows.filter(r=>r.fil!=="ING");
  return "﻿"+[COLONNES.join(";"),...prepas.map(r=>[r.id,r.etab,r.ville,r.fil,"",""].map(champCsv).join(";"))].join("\n")+"\n";
}
// Rend {total, ecoles, top} : intégrés, nombre d'écoles et les n écoles qui en accueillent le plus.
export function resumeDebouches(liste,n=10){
  if(!liste||!liste.length) return null;
  const tri=[...liste].sort((a,b)=>b.integres-a.integres||a.ecole.localeCompare(b.ecole,"fr"));
  return {total:tri.reduce((s,e)=>s+e.integres,0),ecoles:tri.length,top:tri.slice(0,n)};
}
/* Classement des débouchés saisis : intégrés pour 100 places, pour comparer des prépas de tailles différentes.
   Il ne dit rien du prestige des écoles : la liste des écoles reste à lire dans l'infobulle. */
export const classementDebouches=debouches=>({id:"debouches",nom:"Débouchés saisis (intégrés pour 100 places)",court:"Débouchés",
  valeur:r=>{const s=resumeDebouches(debouches[r.id]);return s&&r.capa>0?Math.round(s.total/r.capa*100):null;},sens:1,format:v=>v+" intégrés / 100 places"});
// Fusionne deux saisies : les prépas importées remplacent les mêmes prépas déjà saisies.
export const fusionnerDebouches=(avant,nouveaux)=>({...avant,...nouveaux});
