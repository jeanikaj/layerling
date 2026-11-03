import {describe,it,expect} from "vitest";
import Module from "manifold-3d";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {sceneShape} from "@/lib/shapeCatalog";
import {shapeToManifoldSolid,buildGroupedShapeFromSelection} from "@/lib/editorBooleans";
import {slidingLidParts} from "@/lib/slidingLid";
import {lidForShapes,normalizeLidOptions} from "@/lib/lidTool";
import {roundedRectangleRadius} from "@/lib/roundedSlidingLid";
(globalThis as unknown as {window:unknown}).window={location:{href:pathToFileURL(resolve("apps/web/public")+"/").href}};

export const outer=(radius:number)=>sceneShape({id:"rounded-box",name:"Rounded box",kind:"roundedBox",color:"#aa3333",x:0,z:0,elevation:0,width:60,depth:40,height:30,cornerFillet:radius,topBottomFillet:0,roundedBoxQuality:24,rotation:0});
export const hole=(radius:number)=>sceneShape({id:"rounded-hole",name:"Opening",kind:"roundedBox",hole:true,color:"#aa3333",x:0,z:0,elevation:2,width:56,depth:36,height:30,cornerFillet:Math.max(0,radius-2),topBottomFillet:0,roundedBoxQuality:24,rotation:0});

describe("rounded sliding lids",()=>{
 for(const radius of [3,6,10]) for(const style of ["recessed","flush"] as const) for(const side of ["front","back","left","right"] as const) {
  it(`${radius} mm outer radius, ${style}, ${side}: full travel and a single printable lid`,async()=>{
   const k=await Module();k.setup();const made: {delete?:()=>void}[]=[];
   try {
    const solid=(s:Parameters<typeof shapeToManifoldSolid>[1])=>shapeToManifoldSolid(k,s,made)!;
    const body=solid(outer(radius)).subtract(solid(hole(radius)));made.push(body);
    const opts=normalizeLidOptions({type:"sliding",slidingStyle:style,openingSide:side,thumbGrip:false});
    const result=slidingLidParts(k,body,outer(radius),opts);
    if("error" in result) throw new Error(result.error);
    const lid=solid(result.plate),cut=k.Manifold.union(result.cutters.map(solid));made.push(cut);
    const box=body.subtract(cut);made.push(box);
    expect(box.status()).toBe("NoError");expect(lid.status()).toBe("NoError");
    const parts=box.decompose();made.push(...parts);expect(parts).toHaveLength(1);
    const alongX=side==="left"||side==="right",negative=side==="front"||side==="left",flush=style==="flush";
    const B=flush?0.8*2/2.4:0;
    const topLoX=alongX?(negative?-30:-28+(flush?0.2:-0.6)):-28+(flush?0.2:-0.6);
    const shift=40-topLoX+B;
    const closed=lid.translate([-shift,flush?28:26.6,0]);made.push(closed);
    if(flush) expect(closed.boundingBox().max[1]).toBeCloseTo(30,5);
    for(let d=0;d<=70;d+=0.5) {
      const signed=(negative?-1:1)*d;
      const moving=closed.translate(alongX?[signed,0,0]:[0,0,signed]);
      const overlap=moving.intersect(box);
      expect(overlap.volume(),`interference after ${d} mm`).toBeLessThan(0.005);
      moving.delete();overlap.delete();
    }
    const beyond=closed.translate(alongX?[negative?1:-1,0,0]:[0,0,negative?1:-1]);made.push(beyond);
    const stop=beyond.intersect(box);made.push(stop);expect(stop.volume()).toBeGreaterThan(0.01);
   } finally {Array.from(new Set(made)).reverse().forEach(v=>v.delete?.());}
  });
 }
 it("uses a larger custom radius, refuses a smaller unsafe radius and recognises invalid outlines",async()=>{
  const k=await Module();k.setup();const made: {delete?:()=>void}[]=[];
  try {
   const body=shapeToManifoldSolid(k,outer(6),made)!.subtract(shapeToManifoldSolid(k,hole(6),made)!);made.push(body);
   expect(slidingLidParts(k,body,outer(6),normalizeLidOptions({type:"sliding",cornerMode:"custom",lidCornerRadius:8,thumbGrip:false}))).not.toHaveProperty("error");
   expect(slidingLidParts(k,body,outer(6),normalizeLidOptions({type:"sliding",cornerMode:"custom",lidCornerRadius:1,thumbGrip:false}))).toHaveProperty("error");
   expect(roundedRectangleRadius([[0,0],[10,0],[8,10],[0,10]])).toBeNull();
  } finally {Array.from(new Set(made)).reverse().forEach(v=>v.delete?.());}
 });
 it("creates a grouped rounded lid through the public worker path",async()=>{
   const result=await lidForShapes([outer(6),hole(6)],normalizeLidOptions({type:"sliding",slidingStyle:"flush",clickStop:true}));
   if(!result.lid || !result.sliding) throw new Error("error" in result?result.error:"Missing guides");
   expect(result.sliding.posts).toHaveLength(2);
   const grouped=await buildGroupedShapeFromSelection([outer(6),hole(6)],500000);expect(grouped.group).toBeTruthy();
 });
});


describe("rounded detents",()=>{
 for(const style of ["recessed","flush"] as const) for(const side of ["front","back","left","right"] as const) it(`${style} ${side} seats paired notches away from curved corners`,async()=>{
  const k=await Module();k.setup();const made: {delete?:()=>void}[]=[];
  try {
   const solid=(s:Parameters<typeof shapeToManifoldSolid>[1])=>shapeToManifoldSolid(k,s,made)!;
   const body=solid(outer(6)).subtract(solid(hole(6)));made.push(body);
   const result=slidingLidParts(k,body,outer(6),normalizeLidOptions({type:"sliding",slidingStyle:style,openingSide:side,clickStop:true,thumbGrip:false}));
   if("error" in result || !result.lidAdditions || !result.bodyAdditions) throw new Error("No detent");
   const cuts=k.Manifold.union(result.cutters.map(solid)),reliefs=k.Manifold.union(result.lidAdditions.map(solid)),bumps=k.Manifold.union(result.bodyAdditions.map(solid));made.push(cuts,reliefs,bumps);
   const plainBox=body.subtract(cuts);made.push(plainBox);
   const box=plainBox.add(bumps),lid=solid(result.plate).subtract(reliefs);made.push(box,lid);
   const alongX=side==="left"||side==="right",negative=side==="front"||side==="left",flush=style==="flush";
   const B=flush?0.8*2/2.4:0,topLoX=alongX?(negative?-30:-28+(flush?0.2:-0.6)):-28+(flush?0.2:-0.6);
   const closed=lid.translate([-(40-topLoX+B),flush?28:26.6,0]);made.push(closed);
   const seated=closed.intersect(box);made.push(seated);expect(seated.volume()).toBeLessThan(0.005);
   let peak=0;
   for(let d=0;d<=70;d+=0.5) {
    const signed=(negative?-1:1)*d;
    const moving=closed.translate(alongX?[signed,0,0]:[0,0,signed]);
    const rigid=moving.intersect(plainBox),overlap=moving.intersect(box);
    expect(rigid.volume()).toBeLessThan(0.005);peak=Math.max(peak,overlap.volume());
    moving.delete();rigid.delete();overlap.delete();
   }
   expect(peak).toBeGreaterThan(0.005);expect(peak).toBeLessThan(1);
  } finally {Array.from(new Set(made)).reverse().forEach(v=>v.delete?.());}
 });
});


describe("custom rounded lid profiles",()=>{
 for(const outerRadius of [0,6]) for(const style of ["recessed","flush"] as const) it(`${outerRadius} mm box, ${style}, 8 mm custom lid radius clears full travel`,async()=>{
  const k=await Module();k.setup();const made: {delete?:()=>void}[]=[];
  try {
   const solid=(s:Parameters<typeof shapeToManifoldSolid>[1])=>shapeToManifoldSolid(k,s,made)!;
   const body=solid(outer(outerRadius)).subtract(solid(hole(outerRadius)));made.push(body);
   const result=slidingLidParts(k,body,outer(outerRadius),normalizeLidOptions({type:"sliding",slidingStyle:style,cornerMode:"custom",lidCornerRadius:8,thumbGrip:false}));
   if("error" in result) throw new Error(result.error);
   const cut=k.Manifold.union(result.cutters.map(solid));made.push(cut);
   const box=body.subtract(cut),lid=solid(result.plate);made.push(box);
   const flush=style==="flush",B=flush?0.8*2/2.4:0;
   const closed=lid.translate([-(40+28-(flush?0.2:-0.6)+B),flush?28:26.6,0]);made.push(closed);
   for(let d=0;d<=70;d+=0.5) {
    const moving=closed.translate([0,0,-d]),overlap=moving.intersect(box);
    expect(overlap.volume()).toBeLessThan(0.005);moving.delete();overlap.delete();
   }
  } finally {Array.from(new Set(made)).reverse().forEach(v=>v.delete?.());}
 });
 it("refuses rounded top/bottom edges that reduce the guide's outside wall",async()=>{
  const k=await Module();k.setup();const made: {delete?:()=>void}[]=[];
  try {
   const source=sceneShape({...outer(6),topBottomFillet:1});
   const body=shapeToManifoldSolid(k,source,made)!.subtract(shapeToManifoldSolid(k,hole(6),made)!);made.push(body);
   expect(slidingLidParts(k,body,source,normalizeLidOptions({type:"sliding",slidingStyle:"flush"}))).toHaveProperty("error");
  } finally {Array.from(new Set(made)).reverse().forEach(v=>v.delete?.());}
 });
});
