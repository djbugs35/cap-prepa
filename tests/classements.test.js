import {test} from "node:test";
import assert from "node:assert/strict";
import {CLASSEMENTS_INTEGRES,classementPerso,calculerCentiles,noteSynthese,libelleRang,lireCsvClassements,csvModele,detailClassements,classerSynthese,ordinal} from "../src/classements.js";
import {sortRows,rowsFromData} from "../src/calc.js";

const f=(id,o)=>({id,fil:"MPSI",etab:"Lycée "+id,ville:"Rennes",taux:50,capa:40,voeux:800,mp:[10,30,40,15,5],...o});
const niveau=CLASSEMENTS_INTEGRES.find(c=>c.id==="niveau"),selectivite=CLASSEMENTS_INTEGRES.find(c=>c.id==="selectivite");

test("calculerCentiles : 1 pour le meilleur, 0 pour le moins bon, sens respecté",()=>{
  const rows=[f(1,{taux:20}),f(2,{taux:50}),f(3,{taux:80})];
  const c=calculerCentiles(rows,[selectivite]); // taux bas = plus sélectif = mieux
  assert.equal(c.get(1).selectivite.centile,1);assert.equal(c.get(2).selectivite.centile,.5);assert.equal(c.get(3).selectivite.centile,0);
});
test("calculerCentiles : CPGE et écoles classées séparément, valeurs absentes ignorées",()=>{
  const rows=[f(1,{mp:[50,40,10,0,0]}),f(2),f(3,{fil:"ING",mp:[0,5,50,40,5]}),f(4,{fil:"ING",mp:[0,0,0,0,0]})];
  const c=calculerCentiles(rows,[niveau]);
  assert.equal(c.get(3).niveau.centile,null); // seule école avec un profil publié : pas de rang
  assert.equal(c.get(4).niveau,undefined);
  assert.equal(c.get(1).niveau.centile,1);
});
test("calculerCentiles : ex aequo au milieu de leur plage",()=>{
  const c=calculerCentiles([f(1,{taux:30}),f(2,{taux:30}),f(3,{taux:90})],[selectivite]);
  assert.equal(c.get(1).selectivite.centile,.75);assert.equal(c.get(2).selectivite.centile,.75);
});
test("noteSynthese : moyenne pondérée des centiles disponibles, sur 20",()=>{
  const s={niveau:{centile:1},selectivite:{centile:.5},emploi:{centile:null},"perso:L'Étudiant":{centile:0}};
  assert.deepEqual(noteSynthese(s),{note:10,n:3});
  assert.deepEqual(noteSynthese(s,{perso:0}),{note:15,n:2}); // poids nul : classement ignoré
  assert.deepEqual(noteSynthese(s,{niveau:3,perso:0}),{note:17.5,n:2});
  assert.equal(noteSynthese({}),null);
});
test("classementPerso : un rang plus petit est meilleur",()=>{
  const c=classementPerso({nom:"Presse",rangs:{1:3,2:1}});
  const r=calculerCentiles([f(1),f(2),f(3)],[c]);
  assert.equal(r.get(2)["perso:Presse"].centile,1);assert.equal(r.get(1)["perso:Presse"].centile,0);assert.equal(r.get(3)["perso:Presse"],undefined);
});
test("libelleRang : « mieux que N % », lisible pour les bien et les mal placées",()=>{
  assert.equal(libelleRang(1),"mieux que 100 %");assert.equal(libelleRang(.88),"mieux que 88 %");assert.equal(libelleRang(.15),"mieux que 15 %");
});
test("lireCsvClassements : modèle rempli, séparateurs et guillemets",()=>{
  const csv="﻿id;etablissement;ville;filiere;L'Étudiant;Figaro\n12;\"Lycée A; site 2\";Rennes;MPSI;3e;\n13;Lycée B;Brest;PCSI;1;7\nx;;;;;\n";
  assert.deepEqual(lireCsvClassements(csv),[{nom:"L'Étudiant",rangs:{12:3,13:1}},{nom:"Figaro",rangs:{13:7}}]);
  assert.deepEqual(lireCsvClassements("id,Presse\n5,2\n"),[{nom:"Presse",rangs:{5:2}}]);
  assert.throws(()=>lireCsvClassements("nom;rang\nA;1"),/colonne « id »/);
});
test("csvModele : relu par lireCsvClassements une fois rempli",()=>{
  const m=csvModele([f(7,{etab:'Lycée "Victor"; Hugo'})],["Presse"]);
  assert.deepEqual(lireCsvClassements(m.replace(/;\n$/,";4\n")),[{nom:"Presse",rangs:{7:4}}]);
});
test("sortRows : tri par note de synthèse, formations sans note en dernier",()=>{
  const a=[{d:1,synth:null},{d:2,synth:{note:12}},{d:3,synth:{note:15}}];
  assert.deepEqual(sortRows(a,"synthese").map(r=>r.d),[3,2,1]);
});

test("rowsFromData lit les indicateurs InserSup, sinon les classements emploi et salaire restaient vides",()=>{
  // Bug : formations.json avait insEmploi, mais rowsFromData ne le reprenait pas ; INSA Rennes n'avait que 3 classements.
  const [r]=rowsFromData({meta:{fields:["id","filiere","insEmploi","insSalaire","insPromo"]},rows:[[1,"ING",76,2500,"2024"]]});
  assert.deepEqual([r.insEmploi,r.insSalaire,r.insPromo],[76,2500,"2024"]);
});

test("detailClassements : note /20 de chaque classement et poids appliqué",()=>{
  const c=classementPerso({nom:"Presse",rangs:{1:1,2:2,3:3}});
  const scores={niveau:{valeur:89,centile:.95},attractivite:{valeur:42,centile:.82},"perso:Presse":{valeur:2,centile:null}};
  const d=detailClassements(scores,[...CLASSEMENTS_INTEGRES,c],{attractivite:.5});
  assert.deepEqual(d.map(x=>[x.id,x.note,x.poids]),[["niveau",19,1],["attractivite",16.4,.5],["perso:Presse",null,1]]);
  assert.match(d[0].texte,/89 % TB · mieux que 95 %/);
});

test("ordinal : 1er, puis e",()=>{
  assert.equal(ordinal(1),"1er");assert.equal(ordinal(2),"2e");assert.equal(ordinal(23),"23e");
});
test("classerSynthese : rang 1 à la meilleure note, familles séparées, formations sans note absentes",()=>{
  const rows=[f(1,{taux:20}),f(2,{taux:50}),f(3,{taux:80}),f(4,{fil:"ING",taux:30}),f(5,{fil:"ING",taux:70}),f(6,{taux:null,tauxGen:null})];
  const centiles=calculerCentiles(rows,[selectivite]);
  const r=classerSynthese(rows,centiles,{selectivite:1});
  assert.deepEqual(r.get(1),{rang:1,total:3});assert.deepEqual(r.get(2),{rang:2,total:3});assert.deepEqual(r.get(3),{rang:3,total:3});
  assert.deepEqual(r.get(4),{rang:1,total:2});assert.deepEqual(r.get(5),{rang:2,total:2}); // écoles comptées à part des prépas
  assert.equal(r.get(6),undefined); // ni taux ni tauxGen : aucune valeur pour la sélectivité, donc pas de rang
});
