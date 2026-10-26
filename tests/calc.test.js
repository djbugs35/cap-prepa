import {test} from "node:test";
import assert from "node:assert/strict";
import {score,position,chance,estimation,libelleFourchette,raisons,reglagesDepuis,REGLAGES,tauxLisse,estInstable,avertissementMathsExpertes,historiqueTaux,basculerComparaison,regrouperVoeux,encoderPartage,decoderPartage,liensApresPrepa,memeAcademie,lyceesFromData,chercherLycees,filterRows,sortRows,vowKey,balanceAdvice,norm,dist,rowsFromData,tauxRef,internatInconnu,W} from "../src/calc.js";

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
  const c=chance(row({admis:3}),EL);
  assert.equal(c.cat.k,0);assert.equal(c.c,null);assert.equal(c.p,null);
  assert.ok(chance(row({admis:15}),EL).cat.k>0);
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

test("tauxLisse : la dernière session pèse le plus, une année atypique ne décide pas seule",()=>{
  assert.equal(tauxLisse(row({taux:60,tauxHist:[30,60]})),(30+2*60+3*60)/6);
  assert.equal(tauxLisse(row({taux:50,tauxHist:[]})),50);
  assert.equal(tauxLisse(row({taux:40,tauxGen:50,tauxGenHist:[null,44],tauxHist:[10,10]})),(2*44+3*50)/5); // même indicateur que tauxRef
});
test("estInstable : écart d'au moins 20 points entre sessions",()=>{
  assert.equal(estInstable(row({taux:55,tauxHist:[60,30]})),true);
  assert.equal(estInstable(row({taux:55,tauxHist:[50,52]})),false);
  assert.equal(estInstable(row({taux:55,tauxHist:[]})),false);
});
test("chance : utilise le taux lissé, pas la seule dernière session",()=>{
  const chute=row({taux:20,tauxHist:[80,80]}),stable=row({taux:20,tauxHist:[20,20]});
  assert.ok(chance(chute,EL).c>chance(stable,EL).c);
});
test("estimation : fourchette quand ±0,5 point change l'étiquette",()=>{
  const e=estimation(row(),EL);
  assert.ok(e.bas.k>=e.cat.k&&e.haut.k<=e.cat.k);
  const large=estimation(row(),EL,{...REGLAGES,ecartFourchette:3});
  assert.notEqual(large.bas.k,large.haut.k);
  assert.match(libelleFourchette(large),/^.+ à [a-zé ]+$/);
  assert.equal(libelleFourchette(estimation(row(),EL,{...REGLAGES,ecartFourchette:0})),e.cat.l);
});
test("raisons : position, instabilité, recrutement académique, au plus trois",()=>{
  const r=row({taux:55,tauxHist:[60,30],aca:85});
  const t=raisons(r,EL,estimation(r,EL),[2023,2024]);
  assert.equal(t.length,3);
  assert.match(t[0],/au-dessus d'environ \d+ % des admis/);
  assert.match(t[1],/instable \(de 30 % à 60 %/);
  assert.match(t[2],/85 % des admis/);
});
test("raisons : tendance depuis la plus ancienne session, maths expertes en tête",()=>{
  const r=row({taux:30,tauxHist:[45,38]});
  const sans={...EL,mxon:false};
  const t=raisons(r,sans,estimation(r,sans),[2023,2024]);
  assert.match(t[0],/maths expertes/);
  assert.match(t[2],/baisse depuis 2023 \(45 % puis 30 %\)/);
  assert.match(raisons(row({admis:3}),EL,estimation(row({admis:3}),EL))[0],/Trop peu d'admis \(3\)/);
});
test("reglagesDepuis : config.js remplace les réglages, ignore les valeurs invalides",()=>{
  const R=reglagesDepuis({partPosition:.5,seuilsChances:[.8,.6,.4,.2],poidsMatieres:{PCSI:{pc:6}}});
  assert.equal(R.partPosition,.5);assert.deepEqual(R.seuils,[.8,.6,.4,.2]);
  assert.equal(R.poids.PCSI.pc,6);assert.equal(R.poids.PCSI.m,W.PCSI.m);assert.equal(W.PCSI.pc,4);
  assert.deepEqual(reglagesDepuis({seuilsChances:[.2,.4,.6,.8]}).seuils,REGLAGES.seuils); // seuils non décroissants
  assert.ok(score("PCSI",EL,R.poids)!==score("PCSI",EL));
});
test("avertissementMathsExpertes : seulement sans l'option et si MPSI ou MP2I est visée",()=>{
  assert.match(avertissementMathsExpertes({mxon:false},["MPSI","MP2I","PCSI"]),/MPSI et MP2I/);
  assert.equal(avertissementMathsExpertes({mxon:true},["MPSI"]),null);
  assert.equal(avertissementMathsExpertes({mxon:false},["PCSI"]),null);
});

test("historiqueTaux : années alignées sur les taux, années inconnues retirées",()=>{
  assert.deepEqual(historiqueTaux(row({taux:50,tauxHist:[40,null]}),[2023,2024],2025),[{annee:2023,taux:40},{annee:2025,taux:50}]);
  assert.deepEqual(historiqueTaux(row({taux:50,tauxHist:[]}),[],2025),[{annee:2025,taux:50}]);
});
test("basculerComparaison : ajoute, retire, et garde les 4 plus récentes",()=>{
  assert.deepEqual(basculerComparaison([1,2],3),[1,2,3]);
  assert.deepEqual(basculerComparaison([1,2,3],2),[1,3]);
  assert.deepEqual(basculerComparaison([1,2,3,4],5),[2,3,4,5]);
});

test("regrouperVoeux : les écoles d'un même concours forment un vœu à sous-vœux",()=>{
  const g=regrouperVoeux([row({id:1}),row({fil:"ING",id:10,etab:"Polytech Nantes",det:"Concours Geipi Polytech · Bac général"}),
    row({fil:"ING",id:11,etab:"Polytech Tours",det:"Concours Geipi Polytech · Bac général"}),row({fil:"ING",id:12,etab:"EPF",det:"Bac général"})]);
  assert.equal(g.length,3);
  assert.equal(g[0].reseau,null);
  assert.equal(g[1].reseau,"Concours Geipi Polytech");assert.deepEqual(g[1].formations.map(r=>r.id),[10,11]);
  assert.equal(g[2].reseau,null);
});
test("partage : le fragment redonne la liste, les notes et les choix d'internat",()=>{
  const st={basket:[3,7],n:EL.n,mxon:false,s3type:"SI",avis:"TF",internats:{3:"deux",99:"sans"}};
  const h=encoderPartage(st);
  assert.match(h,/^#/);
  assert.deepEqual(decoderPartage(h),{basket:[3,7],n:EL.n,mxon:false,s3type:"SI",avis:"TF",internats:{3:"deux"}}); // 99 hors liste
});
test("partage : valeurs invalides ignorées, fragment étranger refusé",()=>{
  const d=decoderPartage("#liste=1,abc,-2&notes=12,25,1,1,1,1,1&avis=XX&internat=1:peut-etre");
  assert.deepEqual(d,{basket:[1],internats:{}});
  assert.equal(decoderPartage("#autre=1"),null);
  assert.equal(decoderPartage(""),null);
});

test("liensApresPrepa : concours de 2e année de chaque CPGE, rien pour une école post-bac",()=>{
  const m="https://www.scei-concours.fr/stat{annee}/{filiere}.html";
  assert.deepEqual(liensApresPrepa("PCSI",m,2025).map(l=>l.url),["https://www.scei-concours.fr/stat2025/pc.html","https://www.scei-concours.fr/stat2025/psi.html"]);
  assert.deepEqual(liensApresPrepa("MP2I",m,2025).map(l=>l.filiere),["MPI","MP"]);
  assert.deepEqual(liensApresPrepa("ING",m,2025),[]);
});

test("memeAcademie : accents et tirets ignorés, Île-de-France comptée comme un seul secteur",()=>{
  assert.ok(memeAcademie("Besancon","Besançon"));
  assert.ok(memeAcademie("Nouvelle-Calédonie","Nouvelle Calédonie"));
  assert.ok(memeAcademie("Créteil","Versailles"));
  assert.ok(!memeAcademie("Rennes","Nantes"));
});
test("raisons : le recrutement académique dit si c'est l'académie du lycée de l'élève",()=>{
  const r=row({aca:85,academie:"Rennes"});
  const dire=el=>raisons(r,el,estimation(r,el)).find(t=>/académie/.test(t));
  assert.match(dire({...EL,academie:"Rennes"}),/c'est la vôtre/);
  assert.match(dire({...EL,academie:"Nantes"}),/Rennes, pas la vôtre/);
  assert.match(dire(EL),/\(85 % des admis\)\.$/); // lycée non renseigné
});
test("chercherLycees : tous les mots, sans accents, dans le nom ou la commune",()=>{
  const L=lyceesFromData({meta:{fields:["uai","nom","commune","dep","academie","lat","lon","public"]},rows:[
    ["1","Lycée Chateaubriand","Rennes","035","Rennes",48.12,-1.67,1],["2","Lycée Émile Zola","Rennes","035","Rennes",48.11,-1.68,1],
    ["3","Lycée Émile Zola","Aix-en-Provence","013","Aix-Marseille",43.5,5.4,1]]});
  assert.deepEqual(chercherLycees(L,"emile zola rennes").map(l=>l.uai),["2"]);
  assert.deepEqual(chercherLycees(L,"ZOLA").map(l=>l.uai),["2","3"]);
  assert.deepEqual(chercherLycees(L,"z"),[]); // un seul caractère : trop vague
  assert.equal(L[0].academie,"Rennes");assert.equal(L[0].pub,true);
});
