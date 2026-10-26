import {test} from "node:test";
import assert from "node:assert/strict";
import {lireCsvDebouches,csvModeleDebouches,resumeDebouches,classementDebouches,fusionnerDebouches} from "../src/debouches.js";
import {calculerCentiles} from "../src/classements.js";

test("lireCsvDebouches : une ligne par école, répétitions additionnées, lignes incomplètes ignorées",()=>{
  const csv="id;etablissement;ville;filiere;ecole;integres\n12;Lycée A;Rennes;MPSI;INSA Lyon;5\n12;Lycée A;Rennes;MPSI;insa lyon;2\n12;;;;Centrale Nantes;3\n13;;;;;\n14;;;;Mines;0\n";
  assert.deepEqual(lireCsvDebouches(csv),{12:[{ecole:"INSA Lyon",integres:7},{ecole:"Centrale Nantes",integres:3}]});
  assert.throws(()=>lireCsvDebouches("id;ecole\n1;X"),/integres/);
});
test("csvModeleDebouches : prépas seulement, relu une fois rempli",()=>{
  const m=csvModeleDebouches([{id:5,etab:"Lycée B",ville:"Brest",fil:"PCSI"},{id:6,etab:"École C",ville:"Brest",fil:"ING"}]);
  assert.equal(m.split("\n").filter(Boolean).length,2);
  assert.deepEqual(lireCsvDebouches(m.replace(/;;\n$/,";ENSTA;4\n")),{5:[{ecole:"ENSTA",integres:4}]});
});
test("resumeDebouches : total, nombre d'écoles et top 10 trié",()=>{
  const liste=Array.from({length:12},(_,i)=>({ecole:"E"+i,integres:i+1}));
  const r=resumeDebouches(liste);
  assert.equal(r.total,78);assert.equal(r.ecoles,12);assert.equal(r.top.length,10);assert.equal(r.top[0].ecole,"E11");
  assert.equal(resumeDebouches([]),null);
});
test("classementDebouches : intégrés pour 100 places, prépas sans saisie absentes",()=>{
  const c=classementDebouches({1:[{ecole:"X",integres:20}],2:[{ecole:"Y",integres:40}]});
  const rows=[{id:1,fil:"MPSI",capa:40},{id:2,fil:"MPSI",capa:40},{id:3,fil:"MPSI",capa:40}];
  assert.equal(c.valeur(rows[0]),50);assert.equal(c.valeur(rows[2]),null);
  const centiles=calculerCentiles(rows,[c]);
  assert.equal(centiles.get(2).debouches.centile,1);assert.equal(centiles.get(3).debouches,undefined);
});
test("fusionnerDebouches : une prépa réimportée remplace l'ancienne saisie",()=>{
  assert.deepEqual(fusionnerDebouches({1:[{ecole:"A",integres:1}],2:[]},{1:[{ecole:"B",integres:2}]}),{1:[{ecole:"B",integres:2}],2:[]});
});
