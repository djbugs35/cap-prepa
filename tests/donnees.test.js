import {test} from "node:test";
import assert from "node:assert/strict";
import {etiquetteSource,htmlSources,csvBaseLiens,htmlLiens} from "../src/donnees.js";

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

const BASE={meta:{maj:"2026-10-27T10:00:00+00:00"},lycees:{
  "0440021J":{lycee:"Lycée Clemenceau",ville:"Nantes",filieres:["MPSI","PCSI"],site:"http://g.example",lien:"https://g.example/resultats/",annee:2025,statut:"trouve",verifie:"2026-10-27"},
  "0350001A":{lycee:"Lycée B; site 2",ville:"Rennes",filieres:["PTSI"],site:null,lien:null,statut:"sans-site",verifie:"2026-10-27"}}};
test("csvBaseLiens : une ligne par lycée, filières jointes, champs protégés",()=>{
  const csv=csvBaseLiens(BASE),lignes=csv.trim().split("\n"); // trim retire aussi le BOM
  assert.ok(csv.startsWith("\uFEFF"));assert.equal(lignes.length,3);assert.match(lignes[0],/^uai;lycee;ville;filieres;site;lien/);
  assert.match(lignes[2],/^0440021J;Lycée Clemenceau;Nantes;MPSI PCSI;http:\/\/g.example;https:\/\/g.example\/resultats\/;;2025;trouve/);
  assert.match(lignes[1],/"Lycée B; site 2"/);
  assert.equal(csvBaseLiens(BASE,["0350001A"]).trim().split("\n").length,2);
});
test("htmlLiens : lycées du rayon, manquants comptés, recherche réservée au serveur local",()=>{
  const p={uais:["0440021J","0999999Z"],prepas:[1,2],libelle:"150 km autour de Bruz"};
  const avec=htmlLiens(BASE,p,{enCours:false,journal:[]});
  assert.match(avec,/2 lycées, dont 1 pas encore explorés/);assert.match(avec,/id="liens-tout"/);assert.match(avec,/Lycée Clemenceau/);assert.doesNotMatch(avec,/Lycée B/);
  assert.match(htmlLiens(BASE,p,null),/demande le serveur local/);
});
