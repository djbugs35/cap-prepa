/* Carte schématique en SVG : cercles de distance autour du point de départ, villes de repère, formations colorées par chances. */
import {dist} from "./calc.js";
import {CITIES} from "./geo.js";

const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

export function renderSvgMap(svg,home,radius,list,basket){
  const hl=home.lat,ho=home.lon;
  const W2=640,H2=400,pad=24,kx=Math.cos(hl*Math.PI/180),km=111.2;
  const sc=(H2/2-pad)/Math.max(radius,50),cx=W2/2,cy=H2/2;
  const P=(la,lo)=>[cx+(lo-ho)*kx*km*sc,cy-(la-hl)*km*sc];
  let g="";
  const steps=[25,50,100,150,200,300,400,500].filter(v=>v<radius);
  const rings=[...steps.slice(-3),radius];
  rings.forEach((r,i)=>{const rr=r*sc,last=i===rings.length-1;
    g+=`<circle cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="var(--line)" stroke-width="${last?1.5:1}" ${last?"":'stroke-dasharray="3 4"'}/>`;
    g+=`<text x="${cx+rr*0.707+3}" y="${cy-rr*0.707-3}" font-size="10" fill="var(--muted)">${r} km</text>`;});
  Object.entries(CITIES).forEach(([n,[la,lo]])=>{const [x,y]=P(la,lo);if(x<6||x>W2-60||y<10||y>H2-4)return;
    const d=dist(hl,ho,la,lo);if(d>radius*1.25||d<radius*0.06)return;
    g+=`<circle cx="${x}" cy="${y}" r="1.6" fill="var(--muted)"/><text x="${x+4}" y="${y-4}" font-size="10.5" fill="var(--muted)">${esc(n)}</text>`;});
  const groups={};list.forEach(r=>{const key=r.lat.toFixed(2)+","+r.lon.toFixed(2);(groups[key]=groups[key]||[]).push(r);});
  Object.values(groups).forEach(gr=>{gr.sort((a,b)=>(a.ch.c??-1)-(b.ch.c??-1));
    gr.forEach((r,i)=>{let [x,y]=P(r.lat,r.lon);const a=i*2.4;if(i){x+=Math.cos(a)*3.2*Math.sqrt(i);y+=Math.sin(a)*3.2*Math.sqrt(i);}
      const inB=basket.includes(r.id);
      g+=`<circle data-id="${r.id}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${inB?5.5:4.2}" fill="var(--c${r.ch.cat.k})" stroke="${inB?"var(--ink)":"var(--card)"}" stroke-width="${inB?2:1}" style="cursor:pointer"><title>${esc(r.etab)} · ${r.fil==="ING"?"École":r.fil} · ${r.ch.cat.l}</title></circle>`;});});
  g+=`<path d="M${cx-6},${cy} L${cx+6},${cy} M${cx},${cy-6} L${cx},${cy+6}" stroke="var(--marge)" stroke-width="2.5"/><text x="${cx+8}" y="${cy+14}" font-size="11.5" font-weight="700" fill="var(--marge)">${esc(home.name)}</text>`;
  svg.innerHTML=g;
}
