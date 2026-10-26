/* Recherche des communes via geo.api.gouv.fr, avec repli sur une liste de grandes villes hors connexion. */
import {norm} from "./calc.js";

// Villes de repère sur la carte, et repli si le géocodage en ligne ne répond pas.
export const CITIES={
  "Paris":[48.857,2.352],"Marseille":[43.296,5.37],"Lyon":[45.764,4.836],"Toulouse":[43.605,1.444],"Nice":[43.71,7.262],
  "Nantes":[47.218,-1.554],"Montpellier":[43.611,3.877],"Strasbourg":[48.573,7.752],"Bordeaux":[44.838,-0.579],"Lille":[50.629,3.057],
  "Rennes":[48.111,-1.68],"Reims":[49.258,4.032],"Toulon":[43.124,5.928],"Saint-Étienne":[45.44,4.387],"Le Havre":[49.494,0.108],
  "Grenoble":[45.188,5.725],"Dijon":[47.322,5.041],"Angers":[47.478,-0.563],"Nîmes":[43.837,4.36],"Clermont-Ferrand":[45.778,3.087],
  "Le Mans":[48.0,0.2],"Aix-en-Provence":[43.53,5.447],"Brest":[48.39,-4.486],"Tours":[47.394,0.684],"Amiens":[49.894,2.296],
  "Limoges":[45.833,1.262],"Metz":[49.12,6.176],"Besançon":[47.238,6.024],"Perpignan":[42.699,2.895],"Orléans":[47.903,1.909],
  "Rouen":[49.443,1.1],"Caen":[49.183,-0.371],"Mulhouse":[47.75,7.336],"Nancy":[48.692,6.184],"Poitiers":[46.58,0.34],
  "Pau":[43.296,-0.37],"La Rochelle":[46.16,-1.15],"Vannes":[47.658,-2.76],"Lorient":[47.748,-3.37],"Quimper":[47.996,-4.102],
  "Saint-Brieuc":[48.514,-2.765],"Saint-Malo":[48.649,-2.026],"Laval":[48.073,-0.77],"Cherbourg":[49.64,-1.62],"Bayonne":[43.493,-1.475],
  "Troyes":[48.297,4.074],"Avignon":[43.949,4.806],"Valence":[44.933,4.892],"Chambéry":[45.564,5.918],"Annecy":[45.899,6.129]
};

export async function geocode(api,name){
  const key=norm(name);
  const local=Object.keys(CITIES).find(c=>norm(c)===key);
  try{
    const r=await fetch(api+"?nom="+encodeURIComponent(name)+"&fields=nom,centre,codeDepartement&boost=population&limit=5");
    if(!r.ok)throw new Error(r.status);
    const list=await r.json();
    const hit=list.find(c=>norm(c.nom)===key)||list[0];
    if(hit&&hit.centre) return {name:hit.nom,dep:hit.codeDepartement,lat:hit.centre.coordinates[1],lon:hit.centre.coordinates[0]};
  }catch(e){}
  if(local) return {name:local,lat:CITIES[local][0],lon:CITIES[local][1]};
  return null;
}
export async function suggestions(api,q){
  if(q.length<2)return [];
  try{
    const r=await fetch(api+"?nom="+encodeURIComponent(q)+"&fields=nom,codeDepartement&boost=population&limit=8");
    if(!r.ok)return [];
    return await r.json();
  }catch(e){return [];}
}
