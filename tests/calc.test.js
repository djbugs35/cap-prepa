import {test} from "node:test";
import assert from "node:assert/strict";
import {score,position,chance,filterRows,sortRows,vowKey,balanceAdvice,norm,dist,rowsFromData,tauxRef,internatInconnu,W} from "../src/calc.js";

const EL={n:{m:15,pc:14,mx:14,s3:14,an:14,fr:13,au:13},mxon:true,s3type:"SVT",avis:"F"};
const row=o=>Object.assign({id:1,etab:"Lycée Test",ville:"Rennes",det:"",fil:"MPSI",lat:48.111,lon:-1.68,pub:true,intern:true,internatCode:1,
  taux:50,admis:40,mp:[10,30,40,15,5]},o);

test("score : moyenne pondérée bornée à 0-20",()=>{
  const s=score("MPSI",EL);
  assert.ok(s>14&&s<15,`score ${s}`);
  assert.equal(score("MPSI",{...EL,n:Object.fromEntries(Object.keys(EL.n).map(k=>[k,20])),avis:"TF"}),20);
});
test("score : sans maths expertes, MPSI perd 0,5 en plus du poids retiré",()=>{
  const sans=score("MPSI",{...EL,mxon:false}),avec=score("MPSI",EL);
  assert.ok(avec-sans>0.4);
  assert.equal(score("PCSI",{...EL,mxon:false})>score("MPSI",{...EL,mxon:false}),true);
});
test("score : bonus de la spécialité abandonnée adaptée",()=>{
  const el={...EL,n:{...EL.n,s3:18}};
  assert.ok(score("PTSI",{...el,s3type:"SI"})>score("PTSI",{...el,s3type:"SVT"}));
});
test("score : l'avis du lycée décale le score",()=>{
  assert.ok(score("PCSI",{...EL,avis:"TF"})>score("PCSI",EL));
  assert.ok(score("PCSI",{...EL,avis:"AF"})<score("PCSI",EL));
});

test("position : 19 devant presque tous, 11 derrière presque tous",()=>{
  const mp=[10,30,40,15,5];
  assert.ok(position(19,mp).pos>0.9);
  assert.ok(position(11,mp).pos<0.1);
  assert.equal(position(15,[0,0,0,0,0]),null);
});

test("chance : moins d'admis que le seuil → non estimable",()=>{
  const c=chance(row({admis:3}),EL,15);
  assert.equal(c.cat.k,0);assert.equal(c.c,null);assert.equal(c.p,null);
  assert.ok(chance(row({admis:15}),EL,15).cat.k>0);
});
test("chance : un dossier fort dans une formation peu sélective est en sécurité",()=>{
  const fort={...EL,n:Object.fromEntries(Object.keys(EL.n).map(k=>[k,18.5]))};
  assert.equal(chance(row({taux:90,mp:[2,10,40,38,10]}),fort).cat.l,"Sécurité");
  assert.equal(chance(row({taux:10,mp:[60,35,5,0,0]}),EL).cat.l,"Très ambitieux");
});

test("filterRows : recherche insensible aux accents et à la casse",()=>{
  const rows=[row({id:1,ville:"Orléans"}),row({id:2,ville:"Brest"})];
  const f={home:{lat:48.111,lon:-1.68},radius:600,fils:["MPSI"],pub:false,intern:false,q:"orleans"};
  assert.deepEqual(filterRows(rows,f).map(r=>r.id),[1]);
  assert.deepEqual(filterRows(rows,{...f,q:"BREST"}).map(r=>r.id),[2]);
});
test("filterRows : rayon, filière, public et internat",()=>{
  const rows=[row({id:1}),row({id:2,lat:43.6,lon:1.44}),row({id:3,fil:"PCSI"}),row({id:4,pub:false}),row({id:5,intern:false}),row({id:6,fil:"ING",intern:false,internatCode:null})];
  const f={home:{lat:48.111,lon:-1.68},radius:150,fils:["MPSI","ING"],pub:true,intern:true,q:""};
  assert.deepEqual(filterRows(rows,f).map(r=>r.id),[1,6]); // internat des écoles non renseigné : gardées
  assert.deepEqual(filterRows(rows,{...f,home:null}),[]);
});

test("sortRows : les non estimables passent après",()=>{
  const a=[{d:5,ch:{c:null}},{d:9,ch:{c:0.3}},{d:1,ch:{c:0.8}}];
  assert.deepEqual(sortRows(a,"chance").map(r=>r.d),[1,9,5]);
  assert.deepEqual(sortRows(a,"dist").map(r=>r.d),[1,5,9]);
});

test("vowKey : un concours commun compte pour un vœu",()=>{
  const a=row({fil:"ING",id:10,etab:"Polytech Nantes",det:"Concours Geipi Polytech · Bac général"});
  const b=row({fil:"ING",id:11,etab:"Polytech Tours",det:"Concours Geipi Polytech · Bac général"});
  assert.equal(vowKey(a),vowKey(b));
  assert.notEqual(vowKey(row({id:1})),vowKey(row({id:2})));
});

test("balanceAdvice",()=>{
  assert.match(balanceAdvice([0,0,0,1,1,0],2),/Aucun vœu/);
  assert.match(balanceAdvice([0,2,1,0,1,0],4),/équilibrée/);
  assert.match(balanceAdvice([0,2,1,0,1,0],11),/plus de 10/);
});

test("utilitaires",()=>{
  assert.equal(norm("  Saint-Étienne "),"saint etienne");
  assert.ok(Math.abs(dist(48.111,-1.68,47.218,-1.554)-99.6)<1); // Rennes–Nantes
  assert.equal(W.TSI,undefined); // bacs technologiques hors périmètre
});

test("rowsFromData : colonnes lues d'après meta.fields, dans n'importe quel ordre",()=>{
  const data={meta:{fields:["admis","id","filiere","internat","taux","tauxGen","tauxGenHist","pTBF","pTB","pB","pAB","pSans"]},
    rows:[[174,14,"ING",null,62,70,[60,65],0,12,54,32,2],[40,15,"MPSI",2,30,null,[null],5,20,40,30,5]]};
  const [a,b]=rowsFromData(data);
  assert.equal(a.id,14);assert.equal(a.admis,174);assert.deepEqual(a.mp,[0,12,54,32,2]);assert.deepEqual(a.tauxGenHist,[60,65]);
  assert.ok(internatInconnu(a));assert.equal(b.filles,true);assert.equal(b.intern,true);assert.equal(b.ville,null);
  assert.equal(tauxRef(a),70);assert.equal(tauxRef(b),30); // taux officiel quand l'estimation manque
});
test("chance : le taux des terminales générales remplace le taux officiel",()=>{
  const base=row({taux:20,admis:40});
  assert.ok(chance({...base,tauxGen:80},EL).c>chance(base,EL).c);
});
