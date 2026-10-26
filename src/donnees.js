/* Onglet « Données » : sources open data téléchargées en local, leur version et leur mise à jour.
   La gestion passe par le serveur local (scripts/serveur.py) ; servi autrement, l'onglet n'affiche que le fichier en cours. */

const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const date=iso=>iso?new Date(iso).toLocaleString("fr-FR",{dateStyle:"medium",timeStyle:"short"}):"—";
const jour=iso=>iso?new Date(iso).toLocaleDateString("fr-FR",{dateStyle:"medium"}):"—";
const taille=o=>o==null?"—":(o/1e6).toLocaleString("fr-FR",{maximumFractionDigits:1})+" Mo";
const nb=x=>x==null?"—":Number(x).toLocaleString("fr-FR");
const INTERVALLE_SUIVI_MS=1000;

// Rend [libellé, classe de couleur] de l'état d'une source.
export function etiquetteSource(s){
  if(!s.present) return ["Absente","k5"];
  if(s.aJour===true) return ["À jour","k1"];
  if(s.aJour===false) return ["Mise à jour disponible","k4"];
  return ["Non vérifiée","k0"];
}

// Rend le HTML du fichier de données utilisé par l'outil (meta de data/formations.json).
export function htmlFichierCourant(meta,nbFormations){
  return `<dl class="chiffres"><dt>Session Parcoursup</dt><dd>${esc(meta.session)}</dd><dt>Historique</dt><dd>${esc((meta.sessionsHist||[]).join(", ")||"—")}</dd>
    <dt>Généré le</dt><dd>${jour(meta.generated)}</dd><dt>Formations</dt><dd>${nb(nbFormations)}</dd></dl>`;
}

/* Rend le HTML du tableau des sources et des actions. etat : réponse de GET /api/donnees. */
export function htmlSources(etat){
  const m=etat.miseAJour||{},occupe=m.enCours;
  const lignes=etat.sources.map(s=>{const [l,k]=etiquetteSource(s);
    return `<tr><th scope="row">${esc(s.role)}<small>${esc(s.jeu)}</small></th><td><span class="pill ${k}">${l}</span></td>
      <td>${jour(s.modifie)}${s.modifieDistant&&s.modifieDistant!==s.modifie?`<small>publiée : ${jour(s.modifieDistant)}</small>`:""}</td>
      <td>${date(s.telecharge)}</td><td class="num">${nb(s.lignes)}<small>${taille(s.octets)}</small></td>
      <td><button type="button" class="btn ghost" data-maj="${esc(s.cle)}"${occupe?" disabled":""}>${s.present?"Mettre à jour":"Télécharger"}</button></td></tr>`;}).join("");
  const journal=(m.journal||[]).length?`<pre class="journal" aria-live="polite">${esc(m.journal.join("\n"))}</pre>`:"";
  const statut=occupe?"Mise à jour en cours…":m.erreur?`Échec de la dernière mise à jour : ${esc(m.erreur)}`:m.fin?`Dernière mise à jour terminée le ${date(m.fin)}.`:"";
  return `<div class="compare-bar"><button type="button" class="btn" data-maj="*"${occupe?" disabled":""}>Tout mettre à jour</button>
      <button type="button" class="btn ghost" id="donnees-verifier"${occupe?" disabled":""}>Vérifier les versions publiées</button></div>
    ${etat.erreurVerification?`<p class="hint warn">Vérification impossible : ${esc(etat.erreurVerification)}.</p>`:""}
    <div class="compare-wrap"><table class="compare"><thead><tr><th scope="col">Source</th><th scope="col">État</th><th scope="col">Version locale</th><th scope="col">Téléchargée le</th><th scope="col">Lignes</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead>
    <tbody>${lignes}</tbody></table></div>
    <p class="hint" role="status">${statut}</p>${journal}
    ${!occupe&&m.fin&&!m.erreur?`<p><button type="button" class="btn" id="donnees-recharger">Recharger l'outil avec les nouvelles données</button></p>`:""}`;
}

const SANS_SERVEUR=`<p class="hint">La gestion des données demande le serveur local. Lancez <code>./lancer.command</code> (ou <code>python3 scripts/serveur.py</code>) depuis le dossier de Cap Prépa, puis rouvrez cet onglet.</p>`;

/* Remplit conteneur et le tient à jour. meta, nbFormations : fichier chargé par l'outil. */
export function creerOngletDonnees(conteneur,meta,nbFormations){
  let suivi=null;
  const zone=()=>conteneur.querySelector("#donnees-sources");
  conteneur.innerHTML=`<section class="panel" aria-labelledby="h-fichier"><h2 id="h-fichier">Fichier utilisé par l'outil</h2>${htmlFichierCourant(meta,nbFormations)}</section>
    <section class="panel" aria-labelledby="h-sources"><h2 id="h-sources">Sources open data téléchargées</h2><div id="donnees-sources"><p class="hint">Chargement…</p></div></section>`;
  async function charger(verifier){
    let etat;
    try{
      const r=await fetch("api/donnees"+(verifier?"?verifier=1":""),{cache:"no-store"});
      if(!r.ok||!(r.headers.get("Content-Type")||"").includes("json")) throw new Error("HTTP "+r.status);
      etat=await r.json();
    }catch(e){zone().innerHTML=SANS_SERVEUR;return;}
    zone().innerHTML=htmlSources(etat);
    clearTimeout(suivi);
    if(etat.miseAJour&&etat.miseAJour.enCours) suivi=setTimeout(()=>charger(false),INTERVALLE_SUIVI_MS);
  }
  async function mettreAJour(cle){
    const r=await fetch("api/donnees/mettre-a-jour",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cles:cle==="*"?null:[cle]})});
    if(!r.ok&&r.status!==409){const e=await r.json().catch(()=>({}));zone().insertAdjacentHTML("afterbegin",`<p class="hint warn">${esc(e.erreur||"HTTP "+r.status)}</p>`);}
    charger(false);
  }
  conteneur.addEventListener("click",e=>{
    const b=e.target.closest("[data-maj]");
    if(b){mettreAJour(b.dataset.maj);return;}
    if(e.target.id==="donnees-verifier"){zone().querySelector("[role=status]").textContent="Vérification auprès du catalogue…";charger(true);}
    if(e.target.id==="donnees-recharger") location.reload();
  });
  return {charger};
}
