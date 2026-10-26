import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";

const racine=new URL("../",import.meta.url);
const sw=readFileSync(new URL("sw.js",racine),"utf8");
const fichiers=JSON.parse(sw.match(/const FICHIERS=(\[[^\]]*\])/)[1]);

test("sw.js : chaque module de src/ est mis en cache, sinon l'outil casse hors ligne",()=>{
  for(const f of readdirSync(new URL("src/",racine)).filter(f=>f.endsWith(".js")))
    assert.ok(fichiers.includes("src/"+f),`src/${f} absent de FICHIERS dans sw.js`);
});
test("sw.js : chaque fichier mis en cache existe",()=>{
  for(const f of fichiers.filter(f=>f!=="./")) assert.doesNotThrow(()=>readFileSync(new URL(f,racine)),f);
});
