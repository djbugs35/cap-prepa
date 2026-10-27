/* Onglet « Données » : sources open data téléchargées en local, leur version et leur mise à jour.
   La gestion passe par le serveur local (scripts/serveur.py) ; servi autrement, l'onglet n'affiche que le fichier en cours. */
import {lireCsvClassements,csvModele,champCsv} from "./classements.js";
import {lireCsvDebouches,csvModeleDebouches,fusionnerDebouches} from "./debouches.js";

const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const date=iso=>iso?new Date(iso).toLocaleString("fr-FR",{dateStyle:"medium",timeStyle:"short"}):"—";
const jour=iso=>iso?new Date(iso).toLocaleDateString("fr-FR",{dateStyle:"medium"}):"—";
const taille=o=>o==null?"—":(o/1e6).toLocaleString("fr-FR",{maximumFractionDigits:1})+" Mo";
const nb=x=>x==null?"—":Number(x).toLocaleString("fr-FR");
const INTERVALLE_SUIVI_MS=1000;
// Fichier produit dans le navigateur : rien ne passe par un serveur.
function telecharger(nom,texte){
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([texte],{type:"text/csv;charset=utf-8"}));a.download=nom;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

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

/* Rend le HTML du panneau des classements importés. persos : [{nom, rangs}] ; poids : config.js, poidsClassements. */
export function htmlClassementsPerso(persos,poids){
  const liste=persos.length?`<ul class="perso-liste">${persos.map(c=>`<li><b>${esc(c.nom)}</b> · ${nb(Object.keys(c.rangs).length)} formations classées <button type="button" class="btn ghost" data-suppr="${esc(c.nom)}">Supprimer</button></li>`).join("")}</ul>`
    :`<p class="hint">Aucun classement importé.</p>`;
  return `<p class="hint">Ajoutez vos propres classements (palmarès de presse, avis de professeurs…) : ils restent dans ce navigateur et comptent dans la note de synthèse.</p>
    <ol class="hint"><li>Téléchargez le modèle : une ligne par formation actuellement affichée.</li><li>Dans un tableur, renommez la colonne « Mon classement » et ajoutez-en d'autres si besoin, puis saisissez les rangs (1 = meilleur).</li><li>Enregistrez en CSV et importez-le.</li></ol>
    <div class="compare-bar"><button type="button" class="btn ghost" id="perso-modele">Télécharger le modèle (CSV)</button>
      <label class="btn">Importer un CSV<input type="file" id="perso-fichier" accept=".csv,text/csv" class="sr-only"></label>
      <button type="button" class="btn ghost" id="perso-auto">Charger les CSV de data/</button></div>
    <p class="hint" id="perso-msg" role="status"></p>${liste}
    <p class="hint">Poids dans la note de synthèse (modifiables dans <code>config.js</code>) : ${Object.entries(poids).map(([k,v])=>esc(k)+" "+String(v).replace(".",",")).join(" · ")}.</p>`;
}

// Rend le HTML du panneau des débouchés saisis. debouches : {id prépa: [{ecole, integres}]}.
export function htmlDebouches(debouches){
  const prepas=Object.keys(debouches).length,ecoles=Object.values(debouches).reduce((n,l)=>n+l.length,0);
  return `<p class="hint">Aucune source ouverte ne publie les écoles intégrées par chaque prépa. Saisissez-les pour les prépas qui vous intéressent, d'après le site du lycée ou le palmarès de L'Étudiant (liens dans chaque fiche).</p>
    <ol class="hint"><li>Téléchargez le modèle : une ligne par prépa affichée.</li><li>Pour chaque école intégrée, dupliquez la ligne de la prépa et remplissez « ecole » et « integres » (nombre d'élèves). Lignes vides ignorées.</li><li>Importez le CSV : une prépa importée remplace sa saisie précédente.</li></ol>
    <div class="compare-bar"><button type="button" class="btn ghost" id="deb-modele">Télécharger le modèle (CSV)</button>
      <label class="btn">Importer un CSV<input type="file" id="deb-fichier" accept=".csv,text/csv" class="sr-only"></label>
      ${prepas?`<button type="button" class="btn ghost" id="deb-effacer">Effacer les débouchés saisis</button>`:""}</div>
    <p class="hint" id="deb-msg" role="status">${prepas?`${nb(prepas)} prépa${prepas>1?"s":""} renseignée${prepas>1?"s":""}, ${nb(ecoles)} lignes école.`:"Aucun débouché saisi."}</p>`;
}

const STATUTS_LIEN={"trouve":["Trouvé","k1"],"introuvable":["Introuvable","k4"],"sans-site":["Pas de site connu","k0"],"site-injoignable":["Site injoignable","k5"]};
const COLONNES_LIENS=["uai","lycee","ville","filieres","site","lien","document","annee","statut","verifie"];
// Rend le CSV de la base de liens, limitée aux lycées uais (tous si absent).
export function csvBaseLiens(base,uais){
  const lignes=Object.entries(base.lycees||{}).filter(([u])=>!uais||uais.includes(u)).sort((a,b)=>(a[1].lycee||"").localeCompare(b[1].lycee||"","fr"));
  return "\uFEFF"+[COLONNES_LIENS.join(";"),...lignes.map(([u,x])=>COLONNES_LIENS.map(c=>champCsv(c==="uai"?u:Array.isArray(x[c])?x[c].join(" "):x[c])).join(";"))].join("\n")+"\n";
}
/* Rend le HTML de la rubrique des liens. base : data/liens-resultats.json ; perimetre : {uais, libelle} des lycées
   du rayon ; recherche : état de la recherche en cours (null sans serveur local). */
export function htmlLiens(base,perimetre,recherche){
  const tous=Object.entries(base.lycees||{}),dans=tous.filter(([u])=>perimetre.uais.includes(u));
  const compte=l=>Object.keys(STATUTS_LIEN).map(s=>`${l.filter(([,x])=>x.statut===s).length} ${STATUTS_LIEN[s][0].toLowerCase()}`).join(" · ");
  const manquants=perimetre.uais.filter(u=>!(base.lycees||{})[u]).length,occupe=recherche&&recherche.enCours;
  const lignes=dans.sort((a,b)=>(a[1].lycee||"").localeCompare(b[1].lycee||"","fr")).map(([,x])=>{const [l,k]=STATUTS_LIEN[x.statut]||["?","k0"];
    return `<tr><th scope="row">${esc(x.lycee)}<small>${esc(x.ville)} · ${esc((x.filieres||[]).join(", "))}</small></th><td><span class="pill ${k}">${l}</span></td>
      <td>${x.lien?`<a href="${esc(x.lien)}" target="_blank" rel="noopener">page de résultats</a>${x.annee?" ("+x.annee+")":""}`:"—"}</td><td>${jour(x.verifie)}</td></tr>`;}).join("");
  const commandes=recherche?`<div class="compare-bar"><label class="check"><input type="checkbox" id="liens-tout"> Tout (toute la France, ~230 lycées, environ 1 h 30)</label>
      <label class="check"><input type="checkbox" id="liens-refaire"> Refaire les lycées déjà explorés</label>
      <button type="button" class="btn" id="liens-chercher"${occupe?" disabled":""}>Chercher les liens</button></div>`
    :`<p class="hint">La recherche demande le serveur local (<code>./lancer.command</code>) ; la base livrée reste consultable.</p>`;
  const suivi=recherche&&(recherche.journal||[]).length?`<pre class="journal" aria-live="polite">${esc(recherche.journal.slice(-12).join("\n"))}</pre>`:"";
  return `<p class="hint">Pour chaque lycée à prépa, l'adresse de sa page de résultats aux concours, trouvée en explorant son site (annuaire de l'éducation). Elle pré-remplit la fiche de la prépa pour extraire les débouchés.</p>
    <p><b>Base :</b> ${tous.length} lycées (${compte(tous)})${base.meta&&base.meta.maj?`, mise à jour le ${date(base.meta.maj)}`:""}.<br>
    <b>${esc(perimetre.libelle)} :</b> ${perimetre.uais.length} lycées, dont ${manquants} pas encore explorés.</p>
    ${commandes}<p class="hint" role="status">${occupe?"Recherche en cours…":recherche&&recherche.erreur?"Échec : "+esc(recherche.erreur):""}</p>${suivi}
    ${lignes?`<div class="compare-wrap"><table class="compare"><thead><tr><th scope="col">Lycée</th><th scope="col">État</th><th scope="col">Lien</th><th scope="col">Exploré le</th></tr></thead><tbody>${lignes}</tbody></table></div>`:""}
    <p><button type="button" class="btn ghost" id="liens-csv">Télécharger la base en CSV</button></p>`;
}

const SANS_SERVEUR=`<p class="hint">La gestion des données demande le serveur local. Lancez <code>./lancer.command</code> (ou <code>python3 scripts/serveur.py</code>) depuis le dossier de Cap Prépa, puis rouvrez cet onglet.</p>`;

/* Remplit conteneur et le tient à jour. meta, nbFormations : fichier chargé par l'outil.
   perso : {lister, formations, poids, enregistrer} pour les classements importés (fournis par main.js). */
export function creerOngletDonnees(conteneur,meta,nbFormations,perso){
  let suivi=null;
  const zone=()=>conteneur.querySelector("#donnees-sources");
  conteneur.innerHTML=`<section class="panel" aria-labelledby="h-fichier"><h2 id="h-fichier">Fichier utilisé par l'outil</h2>${htmlFichierCourant(meta,nbFormations)}</section>
    <section class="panel" aria-labelledby="h-perso"><h2 id="h-perso">Classements personnels</h2><div id="perso"></div></section>
    <section class="panel" aria-labelledby="h-deb"><h2 id="h-deb">Débouchés des prépas (saisie)</h2><div id="deb"></div></section>
    <section class="panel" aria-labelledby="h-liens"><h2 id="h-liens">Liens vers les résultats des lycées</h2><div id="liens"></div></section>
    <section class="panel" aria-labelledby="h-sources"><h2 id="h-sources">Sources open data téléchargées</h2><div id="donnees-sources"><p class="hint">Chargement…</p></div></section>`;
  const dessinerPerso=msg=>{conteneur.querySelector("#perso").innerHTML=htmlClassementsPerso(perso.lister(),perso.poids);if(msg)conteneur.querySelector("#perso-msg").textContent=msg;};
  dessinerPerso();
  const dessinerDeb=msg=>{conteneur.querySelector("#deb").innerHTML=htmlDebouches(perso.debouches.lire());if(msg)conteneur.querySelector("#deb-msg").textContent=msg;};
  dessinerDeb();
  let suiviLiens=null;
  async function dessinerLiens(){
    let base,recherche=null;
    try{const r=await fetch("api/liens",{cache:"no-store"});if(!r.ok)throw new Error();({base,recherche}=await r.json());}
    catch(e){base=await fetch("data/liens-resultats.json").then(r=>r.ok?r.json():{lycees:{}}).catch(()=>({lycees:{}}));}
    perso.liens.base=base;
    const zone=conteneur.querySelector("#liens"),tout=zone.querySelector("#liens-tout")?.checked,refaire=zone.querySelector("#liens-refaire")?.checked;
    zone.innerHTML=htmlLiens(base,perso.liens.perimetre(),recherche);
    if(zone.querySelector("#liens-tout")){zone.querySelector("#liens-tout").checked=!!tout;zone.querySelector("#liens-refaire").checked=!!refaire;}
    clearTimeout(suiviLiens);
    if(recherche&&recherche.enCours) suiviLiens=setTimeout(dessinerLiens,2000); else perso.liens.surMaj(base);
  }
  dessinerLiens();
  conteneur.addEventListener("change",async e=>{
    if(e.target.id==="deb-fichier"&&e.target.files[0]){
      try{
        const lus=lireCsvDebouches(await e.target.files[0].text()),n=Object.keys(lus).length;
        if(!n) throw new Error("aucune ligne complète : il faut id, ecole et integres");
        perso.debouches.enregistrer(fusionnerDebouches(perso.debouches.lire(),lus));
        dessinerDeb(`Importé : ${n} prépa${n>1?"s":""}.`);
      }catch(err){dessinerDeb("Import impossible : "+err.message);}
      return;
    }
    if(e.target.id!=="perso-fichier"||!e.target.files[0]) return;
    try{
      const lus=lireCsvClassements(await e.target.files[0].text());
      if(!lus.length) throw new Error("aucun rang trouvé : vérifiez que la colonne id et les rangs sont remplis");
      const noms=new Set(lus.map(c=>c.nom));
      perso.enregistrer([...perso.lister().filter(c=>!noms.has(c.nom)),...lus]); // même nom : remplacé
      dessinerPerso(`Importé : ${lus.map(c=>c.nom).join(", ")}.`);
    }catch(err){dessinerPerso("Import impossible : "+err.message);}
  });
  /* Charge en une fois tous les CSV de classements rangés sous data/ (hors data/sources/), sans passer par le
     sélecteur de fichier. Un fichier illisible ou sans rang est ignoré, listé dans le résumé plutôt que d'arrêter
     les autres. Même nom de classement entre deux fichiers : celui lu en dernier gagne, comme un import manuel. */
  async function chargerCsvLocaux(){
    let fichiers;
    try{
      const r=await fetch("api/classements-locaux",{cache:"no-store"});
      if(!r.ok||!(r.headers.get("Content-Type")||"").includes("json")) throw new Error("HTTP "+r.status);
      ({fichiers}=await r.json());
    }catch(e){dessinerPerso("Chargement automatique impossible : le serveur local doit tourner (./lancer.command).");return;}
    if(!fichiers.length){dessinerPerso("Aucun fichier CSV trouvé sous data/.");return;}
    const lus=[],echecs=[];
    for(const f of fichiers){
      if(f.erreur){echecs.push(`${f.chemin} (${f.erreur})`);continue;}
      try{
        const c=lireCsvClassements(f.contenu);
        if(c.length) lus.push(...c); else echecs.push(`${f.chemin} (aucun rang)`);
      }catch(err){echecs.push(`${f.chemin} (${err.message})`);}
    }
    const dernierParNom=[...new Map(lus.map(c=>[c.nom,c])).values()]; // deux fichiers, meme nom : le dernier gagne
    const noms=new Set(dernierParNom.map(c=>c.nom));
    perso.enregistrer([...perso.lister().filter(c=>!noms.has(c.nom)),...dernierParNom]);
    const resume=`${dernierParNom.length} classement${dernierParNom.length>1?"s":""} chargé${dernierParNom.length>1?"s":""} depuis ${fichiers.length-echecs.length}/${fichiers.length} fichier${fichiers.length>1?"s":""}.`;
    dessinerPerso(echecs.length?`${resume} Ignorés : ${echecs.join(", ")}.`:resume);
  }
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
    if(e.target.id==="perso-modele") telecharger("cap-prepa-classements.csv",csvModele(perso.formations()));
    if(e.target.id==="perso-auto") chargerCsvLocaux();
    if(e.target.id==="liens-chercher"){
      const z=conteneur.querySelector("#liens"),tout=z.querySelector("#liens-tout").checked;
      fetch("api/liens/chercher",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({prepas:tout?null:perso.liens.perimetre().prepas,refaire:z.querySelector("#liens-refaire").checked})}).then(dessinerLiens);
    }
    if(e.target.id==="liens-csv") telecharger("cap-prepa-liens-resultats.csv",csvBaseLiens(perso.liens.base||{lycees:{}}));
    if(e.target.id==="deb-modele") telecharger("cap-prepa-debouches.csv",csvModeleDebouches(perso.formations()));
    if(e.target.id==="deb-effacer"){perso.debouches.enregistrer({});dessinerDeb("Débouchés saisis effacés.");}
    const s=e.target.closest("[data-suppr]");
    if(s){perso.enregistrer(perso.lister().filter(c=>c.nom!==s.dataset.suppr));dessinerPerso(`Classement « ${s.dataset.suppr} » supprimé.`);}
  });
  return {charger};
}
