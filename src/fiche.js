/* Fiche détaillée d'une formation et comparaison côte à côte (2 à 4 formations), rendues en HTML.
   Les formations reçues portent déjà leur estimation (r.ch, voir estimation() dans calc.js) et leur distance (r.d). */
import {libelleFourchette,historiqueTaux,internatInconnu,tauxRef,liensApresPrepa} from "./calc.js";

const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const MENTIONS=["TB félicitations","TB","B","AB","Sans mention"];
const nb=x=>x==null?"—":Number(x).toLocaleString("fr-FR");
const pct=x=>x==null?"—":x+" %";

const lienParcoursup=r=>r.lien||"https://dossierappel.parcoursup.fr/Candidats/public/fiches/afficherFicheFormation?g_ta_cod="+r.id+"&typeBac=0&originePc=0";
const filiere=r=>r.fil==="ING"?"École":r.fil;
const internat=r=>r.filles?"Oui, filles uniquement":r.intern?"Oui":internatInconnu(r)?"Non renseigné":"Non";

function barresTaux(hist){
  if(!hist.length) return `<p class="hint">Historique indisponible.</p>`;
  return `<div class="histo" role="list">${hist.map(h=>`<div role="listitem"><span class="mono">${h.annee}</span><span class="bar"><i style="width:${h.taux}%"></i></span><span class="mono">${h.taux} %</span></div>`).join("")}</div>`;
}
function barresMentions(mp){
  const tot=mp.reduce((a,b)=>a+(b||0),0);
  if(!tot) return `<p class="hint">Profil des admis non publié.</p>`;
  return `<div class="histo" role="list">${mp.map((v,i)=>`<div role="listitem"><span>${MENTIONS[i]}</span><span class="bar"><i style="width:${(v||0)/tot*100}%;background:var(--m${i+1})"></i></span><span class="mono">${pct(v??0)}</span></div>`).join("")}</div>`;
}

function sectionClassements(r){
  if(!r.clDetail||!r.clDetail.length) return "";
  const synth=r.synth?`<p><b class="mono">${String(r.synth.note).replace(".",",")}/20</b> <span class="hint" style="display:inline">note de synthèse sur ${r.synth.n} classement${r.synth.n>1?"s":""}</span></p>`:"";
  return `<section><h3>Classements</h3>${synth}<dl class="chiffres">${r.clDetail.map(c=>`<dt>${esc(c.nom)}</dt><dd>${esc(c.texte)}</dd>`).join("")}</dl>
    <p class="hint">Rangs parmi les ${r.fil==="ING"?"écoles post-bac":"CPGE"} de France ; « mieux que 88 % » : la formation fait mieux que 88 % de celles de sa famille.</p></section>`;
}

function apresPrepa(r,scei){
  const liens=liensApresPrepa(r.fil,scei.modele,scei.annee);
  if(!liens.length) return "";
  return `<section><h3>Après la prépa</h3><p class="hint">En fin de 2e année, les concours des écoles d'ingénieurs. Inscrits, admissibles, intégrés et places par école, session ${scei.annee} (SCEI) :</p>
    <p>${liens.map(l=>`<a class="btn ghost" href="${esc(l.url)}" target="_blank" rel="noopener">${l.filiere}</a>`).join(" ")}</p>
    <p class="hint">Le SCEI ne publie plus de résultats par lycée : ces chiffres valent pour toute la filière.</p>
    ${debouchesDuLycee(r,scei)}</section>`;
}
// Écoles intégrées saisies pour cette prépa, et où chercher ces résultats (palmarès, site du lycée).
function debouchesDuLycee(r,scei){
  const requete=encodeURIComponent(`résultats concours ${r.fil} ${r.etab} ${r.ville||""}`);
  const liens=[scei.palmares&&`<a class="btn ghost" href="${esc(scei.palmares)}" target="_blank" rel="noopener">Palmarès des prépas (L'Étudiant)</a>`,
    scei.recherche&&`<a class="btn ghost" href="${esc(scei.recherche.replace("{q}",requete))}" target="_blank" rel="noopener">Résultats publiés par le lycée</a>`].filter(Boolean).join(" ");
  const source=r.debSource?` Source : <a href="${esc(r.debSource.url)}" target="_blank" rel="noopener">résultats du lycée</a>${r.debSource.annee?" ("+r.debSource.annee+")":""}.`:" (vos saisies)";
  const saisie=r.deb?`<p><b>${r.deb.total} intégrés</b> dans ${r.deb.ecoles} école${r.deb.ecoles>1?"s":""}.${source}</p>
    <ol>${r.deb.top.map(e=>`<li>${esc(e.ecole)} — ${e.integres}</li>`).join("")}</ol>`
    :`<p class="hint">Aucun débouché enregistré pour cette prépa.</p>`;
  return `<h3>Débouchés de cette prépa</h3>${saisie}
    <div class="deb-chercher" data-prepa="${r.id}" data-filiere="${esc(r.fil)}">
      <p class="hint">Pour les récupérer : ouvrez la recherche, repérez la page « résultats aux concours » ou « intégrations » du lycée, puis collez son adresse (page ou PDF).</p>
      <p>${liens}</p>
      ${r.lienResultats?`<p class="hint">Adresse trouvée dans la base de liens (onglet « Données ») : vérifiez-la ou remplacez-la.</p>`:""}
      <div class="cityrow"><input type="url" id="deb-url" value="${esc(r.lienResultats||"")}" placeholder="https://… page ou PDF de résultats" aria-label="Adresse de la page de résultats du lycée">
        <button type="button" class="btn" data-extraire>Extraire</button></div>
      <p class="hint" id="deb-etat" role="status"></p><div id="deb-proposition"></div>
    </div>`;
}

/* Rend le tableau de validation des écoles extraites (réponse de POST /api/debouches/extraire) :
   chaque ligne se décoche ou se corrige avant enregistrement. */
export function htmlPropositionDebouches(res,filiere){
  return `<p class="hint">${res.ecoles.length} écoles lues dans <a href="${esc(res.source)}" target="_blank" rel="noopener">ce document</a>${res.annee?" ("+res.annee+")":""}, classes de ${esc(filiere==="BCPST"?"BCPST":"2e année suivant la "+filiere)}. Vérifiez avant d'enregistrer : la lecture automatique peut se tromper.</p>
    <div class="compare-wrap"><table class="compare deb-table"><thead><tr><th scope="col">Garder</th><th scope="col">École</th><th scope="col">Intégrés</th></tr></thead><tbody>
    ${res.ecoles.map((e,i)=>`<tr><td><input type="checkbox" checked aria-label="Garder la ligne ${i+1}"></td><td><input type="text" value="${esc(e.ecole)}" aria-label="École, ligne ${i+1}"></td><td><input type="number" min="1" max="999" value="${e.integres}" aria-label="Intégrés, ligne ${i+1}"></td></tr>`).join("")}
    </tbody></table></div>
    <p><button type="button" class="btn" data-enregistrer-deb data-source="${esc(res.source)}" data-annee="${res.annee??""}">Enregistrer pour cette prépa</button></p>`;
}

/* Rend le HTML de la fiche. annees : meta.sessionsHist ; session : meta.session ; scei : {modele, annee} (config.js). */
export function htmlFiche(r,annees,session,scei){
  const e=r.ch,rang=r.rang!=null?`rang ${nb(r.rang)}${r.cla!=null?" sur "+nb(r.cla)+" classés":""}`:"non publié";
  return `<h2 id="fiche-titre"><span class="badge${r.pub?"":" priv"}">${filiere(r)}</span>${esc(r.etab)}</h2>
  <p class="hint">${esc(r.ville||"")}${r.dep?" ("+esc(r.dep)+")":""} · ${Math.round(r.d)} km${r.det?" · "+esc(r.det):""} · ${r.pub?"public":"privé"}</p>
  <section><h3>Chances estimées</h3>
    <p><span class="pill k${e.cat.k}">${e.cat.l}</span>${e.bas.k!==e.haut.k?` <span class="hint" style="display:inline">${libelleFourchette(e)} selon les notes finales</span>`:""}</p>
    <ul>${e.raisons.map(t=>`<li>${esc(t)}</li>`).join("")}</ul></section>
  ${sectionClassements(r)}
  <section><h3>Taux d'accès ${r.tauxGen!=null?"des terminales générales":""}</h3>${barresTaux(historiqueTaux(r,annees,session))}
    ${r.tauxGen!=null&&r.tauxGen!==r.taux?`<p class="hint">Taux officiel ${session}, tous candidats confondus : ${r.taux} %.</p>`:""}</section>
  <section><h3>Profil des admis ${session} (mention au bac)</h3>${barresMentions(r.mp)}</section>
  <section><h3>En chiffres</h3><dl class="chiffres">
    <dt>Places</dt><dd>${nb(r.capa)}</dd><dt>Vœux reçus</dt><dd>${nb(r.voeux)}</dd>
    <dt>Dernier appelé</dt><dd>${rang}</dd><dt>Admis</dt><dd>${nb(r.admis)}</dd>
    <dt>Boursiers</dt><dd>${pct(r.bours)}</dd><dt>Filles</dt><dd>${pct(r.fem)}</dd>
    <dt>Même académie</dt><dd>${pct(r.aca)}</dd><dt>Internat</dt><dd>${internat(r)}</dd></dl></section>
  ${scei?apresPrepa(r,scei):""}
  <p><a class="btn" href="${esc(lienParcoursup(r))}" target="_blank" rel="noopener">Fiche officielle sur Parcoursup</a></p>`;
}

/* Rend le tableau comparatif : une colonne par formation, une ligne par critère. */
export function htmlComparaison(rs){
  const lignes=[
    ["Chances",r=>`<span class="pill k${r.ch.cat.k}">${r.ch.cat.l}</span>${r.ch.bas.k!==r.ch.haut.k?`<br><small>${libelleFourchette(r.ch)}</small>`:""}`],
    ["Note de synthèse",r=>r.synth?`${String(r.synth.note).replace(".",",")}/20<small>${r.synth.n} classement${r.synth.n>1?"s":""}</small>`:"—"],
    ["Distance",r=>Math.round(r.d)+" km"],
    ["Taux d'accès",r=>pct(tauxRef(r))+(r.ch.instable?" <small>instable</small>":"")],
    ["Admis TB ou TB fél.",r=>pct((r.mp[0]||0)+(r.mp[1]||0))],
    ["Places",r=>nb(r.capa)],
    ["Même académie",r=>pct(r.aca)],
    ["Boursiers",r=>pct(r.bours)],
    ["Internat",internat],
    ["Statut",r=>r.pub?"Public":"Privé"],
  ];
  // Une ligne par classement où figure au moins une des formations comparées.
  const vus=new Map();rs.forEach(r=>(r.clDetail||[]).forEach(c=>vus.set(c.id,c.nom)));
  for(const [id,nom] of vus) lignes.push([esc(nom),r=>{const c=(r.clDetail||[]).find(x=>x.id===id);return c?esc(c.texte):"—";}]);
  return `<h2 id="fiche-titre">Comparaison</h2><div class="compare-wrap"><table class="compare">
    <thead><tr><th scope="col"><span class="sr-only">Critère</span></th>${rs.map(r=>`<th scope="col"><span class="badge${r.pub?"":" priv"}">${filiere(r)}</span>${esc(r.etab)}<small>${esc(r.ville||"")}</small></th>`).join("")}</tr></thead>
    <tbody>${lignes.map(([l,f])=>`<tr><th scope="row">${l}</th>${rs.map(r=>`<td>${f(r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
