import {test} from "node:test";
import assert from "node:assert/strict";
import {etiquetteSource,htmlSources} from "../src/donnees.js";

const source=o=>({cle:"parcoursup",jeu:"fr-esr-parcoursup",role:"Statistiques",present:true,modifie:"2026-03-09T16:54:47+00:00",
  telecharge:"2026-10-26T18:29:00+00:00",lignes:932,octets:2683453,...o});

test("etiquetteSource : absente, à jour, mise à jour disponible, non vérifiée",()=>{
  assert.equal(etiquetteSource(source({present:false}))[0],"Absente");
  assert.equal(etiquetteSource(source({aJour:true}))[0],"À jour");
  assert.equal(etiquetteSource(source({aJour:false}))[0],"Mise à jour disponible");
  assert.equal(etiquetteSource(source())[0],"Non vérifiée");
});
test("htmlSources : boutons désactivés pendant une mise à jour, date publiée affichée si elle diffère",()=>{
  const libre=htmlSources({sources:[source({modifieDistant:"2026-11-01T00:00:00+00:00",aJour:false})],miseAJour:{enCours:false}});
  assert.match(libre,/publiée :/);assert.doesNotMatch(libre,/disabled/);
  const occupe=htmlSources({sources:[source()],miseAJour:{enCours:true,journal:["Téléchargement : <x>"]}});
  assert.match(occupe,/disabled/);assert.match(occupe,/en cours/);
  assert.match(occupe,/&lt;x&gt;/); // journal échappé
});
