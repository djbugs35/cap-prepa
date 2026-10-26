/* Liste de vœux : rendu à l'écran (vœux, sous-vœux des concours, internat) et version imprimable.
   Les formations reçues portent leur estimation (r.ch) et leur distance (r.d). */
import {CH,NON_ESTIMABLE,regrouperVoeux,balanceAdvice,libelleFourchette,tauxRef} from "./calc.js";

const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=x=>(Math.round(x*10)/10).toFixed(1).replace(".",",");
export const CHOIX_INTERNAT=[["avec","Avec internat"],["sans","Sans internat"],["deux","Avec et sans internat"]];
const NOTES=[["m","Maths"],["pc","Physique-chimie"],["mx","Maths expertes"],["s3","Spécialité abandonnée"],["an","Anglais"],["fr","Français"],["au","Autres matières"]];
// Choix par défaut : avec internat quand la formation en propose un.
export const choixInternat=(r,internats)=>r.intern?internats[r.id]||"avec":null;
const nom=r=>(r.fil==="ING"?"":`<b>${r.fil}</b> `)+esc(r.etab);

function ligne(r,internats,sousVoeu){
  const choix=choixInternat(r,internats);
  const select=choix&&r.fil!=="ING"?`<select class="bk-int" data-internat="${r.id}" aria-label="Internat pour ${esc(r.etab)}">${CHOIX_INTERNAT.map(([v,l])=>`<option value="${v}"${v===choix?" selected":""}>${l}</option>`).join("")}</select>`:"";
  return `<div class="bk-row${sousVoeu?" sous":""}"><i class="dot" style="background:var(--c${r.ch.cat.k})" title="${r.ch.cat.l}"></i><span>${nom(r)} <span class="hint" style="display:inline">${Math.round(r.d)} km</span>${select}</span><button type="button" class="x" data-rm="${r.id}" aria-label="Retirer ${esc(r.etab)}">×</button></div>`;
}
const groupe=(g,internats)=>g.reseau
  ?`<div class="bk-reseau"><b>${esc(g.reseau)}</b> <span class="hint" style="display:inline">1 vœu · ${g.formations.length} sous-vœu${g.formations.length>1?"x":""}</span></div>`+g.formations.map(r=>ligne(r,internats,true)).join("")
  :g.formations.map(r=>ligne(r,internats,false)).join("");

/* Rend le HTML du panneau « Ma liste de vœux ». items : triés du plus sûr au plus risqué. */
export function htmlListe(items,internats){
  if(!items.length) return `<p class="hint">Cliquez sur « Ajouter » pour construire une liste et vérifier qu'elle est équilibrée.</p>`;
  const cnt=[0,0,0,0,0,0];items.forEach(r=>cnt[r.ch.cat.k]++);
  const groupes=regrouperVoeux(items),vows=groupes.length;
  return `<div class="balance">${[...CH,NON_ESTIMABLE].map(c=>cnt[c.k]?`<i style="width:${cnt[c.k]/items.length*100}%;background:var(--c${c.k})" title="${c.l} : ${cnt[c.k]}"></i>`:"").join("")}</div>
   <p class="advice"><b class="mono">${vows}/10</b> vœux estimés. ${balanceAdvice(cnt,vows)}</p>`+
   groupes.map(g=>groupe(g,internats)).join("")+
   `<div class="bk-acts"><button type="button" class="btn" id="bk-print">Imprimer ou enregistrer en PDF</button><button type="button" class="btn ghost" id="bk-share">Copier le lien de la liste</button></div>
   <p class="hint" id="bk-msg" role="status"></p>
   <p class="hint">Un concours commun (Geipi Polytech, Puissance Alpha, Avenir…) compte pour un seul vœu, ses écoles sont des sous-vœux. Une CPGE demandée avec et sans internat compte aussi pour un seul vœu. Règles à vérifier sur Parcoursup.</p>`;
}

/* Rend la version imprimable : notes, vœux et sous-vœux avec leur estimation, pour en parler avec le professeur principal.
   el : {n, mxon, home, academie} ; session : meta.session. */
export function htmlImpression(items,el,internats,session){
  const date=new Date().toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"});
  const notes=NOTES.filter(([k])=>k!=="mx"||el.mxon).map(([k,l])=>`<td>${l}<br><b>${fmt(el.n[k])}</b></td>`).join("");
  const lignes=regrouperVoeux(items).map((g,i)=>g.formations.map((r,j)=>{
    const choix=r.fil!=="ING"?choixInternat(r,internats):null;
    return `<tr><td>${j?"":i+1}</td><td>${g.reseau&&!j?`<b>${esc(g.reseau)}</b><br>`:""}${g.reseau?"↳ ":""}${nom(r)}<br><small>${esc(r.ville||"")} · ${Math.round(r.d)} km${choix?" · "+CHOIX_INTERNAT.find(c=>c[0]===choix)[1].toLowerCase():""}</small></td>
      <td>${r.ch.cat.l}${r.ch.bas.k!==r.ch.haut.k?`<br><small>${libelleFourchette(r.ch)}</small>`:""}</td><td>${tauxRef(r)} %${r.ch.instable?"<br><small>instable</small>":""}</td><td>${r.ch.raisons.map(esc).join("<br>")}</td></tr>`;}).join("")).join("");
  return `<h1>Ma liste de vœux · Cap Prépa</h1>
  <p>${date}${el.home?" · depuis "+esc(el.home.name):""}${el.academie?" · académie de "+esc(el.academie):""} · données Parcoursup ${session??""}</p>
  <table class="imp-notes"><tr>${notes}</tr></table>
  ${el.mxon?"":"<p>L'élève ne suit pas l'option maths expertes.</p>"}
  <table class="imp-voeux"><thead><tr><th>Vœu</th><th>Formation</th><th>Chances estimées</th><th>Accès</th><th>Pourquoi</th></tr></thead><tbody>${lignes}</tbody></table>
  <p><small>Estimation indicative à partir de l'open data Parcoursup : le niveau du lycée, les appréciations et le rang dans la classe ne sont pas publics et pèsent beaucoup. À vérifier sur les fiches officielles.</small></p>`;
}
