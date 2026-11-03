import { describe, it, expect } from "vitest";
import Module from "manifold-3d";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
(globalThis as unknown as { window: unknown }).window = { location: { href: pathToFileURL(resolve("apps/web/public") + "/").href } };
import { slidingLidParts } from "@/lib/slidingLid";
import { lidForShapes, normalizeLidOptions, groupedWithMagnets } from "@/lib/lidTool";
import { sceneShape } from "@/lib/shapeCatalog";
import { shapeToManifoldSolid, buildGroupedShapeFromSelection } from "@/lib/editorBooleans";
import { getManifoldRuntime } from "@/lib/editorMeshCore";

const source = sceneShape({ id:"box", name:"Test box",kind:"box",width:60,height:30,depth:40,x:0,z:0,elevation:0,rotation:0 });
async function setup(wall=2) {
  const k=await Module(); k.setup();
  const outer=k.Manifold.cube([60,30,40]).translate([-30,0,-20]);
  const inner=k.Manifold.cube([60-2*wall,30,40-2*wall]).translate([-30+wall,wall,-20+wall]);
  const body=outer.subtract(inner); outer.delete();inner.delete();
  return { k, body };
}
describe("sliding lid: real geometry", () => {
  for (const side of ["front","back","left","right"] as const) {
    it(`fits throughout travel from the ${side}, with a closed-end stop`, async () => {
      const {k,body}=await setup();
      const made: { delete?:()=>void }[]=[body];
      try {
        const options=normalizeLidOptions({type:"sliding",openingSide:side,thumbGrip:false});
        const result=slidingLidParts(k,body,source,options);
        if ("error" in result) throw new Error(result.error);
        const plate=shapeToManifoldSolid(k,result.plate,made)!;
        const cuts=result.cutters.map(s=>shapeToManifoldSolid(k,s,made)!);
        const cut=k.Manifold.union(cuts);made.push(cut);
        const modified=body.subtract(cut);made.push(modified);
        expect(modified.status()).toBe("NoError");
        const components=modified.decompose();made.push(...components);
        expect(components).toHaveLength(1);
        const low=30-1.2-2-0.4;
        // Undo print placement; plate is laid 10 mm to the right of the box.
        const originalMinX = side === "left" ? -30 : side === "right" ? -27.8 : -28.6;
        const placed=plate.translate([originalMinX-40,low+0.2,0]);
        made.push(placed);
        const alongX=side==="left"||side==="right";
        const sign=side==="front"||side==="left" ? -1:1;
        const travel=alongX ? 60:40;
        for(let distance=0;distance<=travel+10;distance+=0.5) {
          const shift: [number,number,number]=alongX?[sign*distance,0,0]:[0,0,sign*distance];
          const moving=placed.translate(shift),overlap=moving.intersect(modified);
          expect(overlap.volume(),`interference at ${distance} mm`).toBeLessThan(0.001);
          overlap.delete();moving.delete();
        }
        const beyond=placed.translate(alongX?[-sign,0,0]:[0,0,-sign]);
        const stopped=beyond.intersect(modified);made.push(beyond,stopped);
        expect(stopped.volume()).toBeGreaterThan(0.1);
        expect(result.plate.elevation).toBe(0);
      } finally { Array.from(new Set(made)).reverse().forEach(s=>s.delete?.()); }
    });
  }
  it("refuses guides that break through thin outside walls", async()=>{
    const {k,body}=await setup(1.6);
    try { expect(slidingLidParts(k,body,source,normalizeLidOptions({type:"sliding"}))).toHaveProperty("error"); }
    finally { body.delete(); }
  });
  it("rejects a divider in the guide path, but accepts one below it", async()=>{
    const {k,body}=await setup();
    for(const height of [20,28]) {
      const divider=k.Manifold.cube([2,height,36]).translate([-1,0,-18]);
      const divided=body.add(divider);
      const result=slidingLidParts(k,divided,source,normalizeLidOptions({type:"sliding"}));
      expect("error" in result).toBe(height===28);
      divided.delete();divider.delete();
    }
    body.delete();
  });
  it("makes a recessed grip without cutting through the plate",async()=>{
    const {k,body}=await setup();const made: {delete?:()=>void}[]=[body];
    try {
      const result=slidingLidParts(k,body,source,normalizeLidOptions({type:"sliding",thickness:0.4}));
      if("error" in result) throw new Error(result.error);
      expect(result.grip).toBeDefined();
      const plate=shapeToManifoldSolid(k,result.plate,made)!,grip=shapeToManifoldSolid(k,result.grip!,made)!;
      const lid=plate.subtract(grip);made.push(lid);
      expect(lid.status()).toBe("NoError");expect(lid.volume()).toBeGreaterThan(plate.volume()*0.9);
      expect(result.grip!.elevation).toBeGreaterThan(result.plate.elevation!);
    } finally { Array.from(new Set(made)).reverse().forEach(s=>s.delete?.()); }
  });
  it("refuses rotated openings and an excessively shallow guide height",async()=>{
    const {k,body}=await setup();const rotated=body.rotate([0,25,0]);
    try {
      expect(slidingLidParts(k,rotated,source,normalizeLidOptions({type:"sliding"}))).toHaveProperty("error");
      expect(slidingLidParts(k,body,source,normalizeLidOptions({type:"sliding",thickness:10,guideRoof:5,verticalGap:1}))).not.toHaveProperty("error");
      const shallow=body.scale([1,0.2,1]);
      try { expect(slidingLidParts(k,shallow,source,normalizeLidOptions({type:"sliding",thickness:5}))).toHaveProperty("error"); }
      finally { shallow.delete(); }
    } finally { rotated.delete();body.delete(); }
  });
  it("refuses a missing guide roof even when the middle section is a valid ring",async()=>{
    const {k,body}=await setup();
    const notch=k.Manifold.cube([4,1,10]).translate([27,29.2,-5]);
    const notched=body.subtract(notch);
    try { expect(slidingLidParts(k,notched,source,normalizeLidOptions({type:"sliding"}))).toHaveProperty("error"); }
    finally {notched.delete();notch.delete();body.delete();}
  });
  it("runs the public worker path and keeps editable lid/body parts",async()=>{
    const outer=source;
    const hole=sceneShape({id:"cavity",name:"Cavity",kind:"box",hole:true,width:56,height:30,depth:36,x:0,z:0,elevation:2,rotation:0});
    const result=await lidForShapes([outer,hole],normalizeLidOptions({type:"sliding"}));
    if(!result.lid || !result.sliding) throw new Error("error" in result?result.error:"Missing guides");
    expect(result.lid.groupedShapes).toHaveLength(2);
    const grouped=await groupedWithMagnets([outer,hole],{posts:[],pockets:result.sliding.cutters},s=>buildGroupedShapeFromSelection(s,500000));
    expect(grouped.group).toBeTruthy();
    expect(grouped.group!.groupedShapes).toHaveLength(3);
    const reopened=JSON.parse(JSON.stringify([grouped.group,result.lid]));
    const k=await getManifoldRuntime();const made: {delete?:()=>void}[]=[];
    try { for(const shape of reopened) expect(shapeToManifoldSolid(k,shape,made)!.status()).toBe("NoError"); }
    finally { Array.from(new Set(made)).reverse().forEach(s=>s.delete?.()); }
  });
});


describe("flush sliding lid: real geometry", () => {
  for(const side of ["front","back","left","right"] as const) {
    it(`sits flush, slides freely from ${side}, and is retained against lifting`,async()=>{
      const {k,body}=await setup();const made: {delete?:()=>void}[]=[body];
      try {
        const options=normalizeLidOptions({type:"sliding",slidingStyle:"flush",openingSide:side,thumbGrip:false});
        const result=slidingLidParts(k,body,source,options);
        if("error" in result) throw new Error(result.error);
        expect(result.rails).toHaveLength(2);
        const solid=(shape: Parameters<typeof shapeToManifoldSolid>[1])=>shapeToManifoldSolid(k,shape,made)!;
        const lid=k.Manifold.union([result.plate,...result.rails!].map(solid));made.push(lid);
        const cutters=k.Manifold.union(result.cutters.map(solid));made.push(cutters);
        const box=body.subtract(cutters);made.push(box);
        expect(lid.status()).toBe("NoError");expect(box.status()).toBe("NoError");
        const components=lid.decompose();made.push(...components);expect(components).toHaveLength(1);
        const alongX=side==="left"||side==="right", negative=side==="front"||side==="left";
        const railWidth=0.8*2/2.4;
        const shiftX=alongX ? 40-(negative?-30:-27.8) : 40+27.8+railWidth;
        const closed=lid.translate([-shiftX,28,0]);made.push(closed);
        expect(closed.boundingBox().max[1]).toBeCloseTo(30,6);
        const sign=negative?-1:1;
        for(let d=0;d<=70;d+=0.5) {
          const moving=closed.translate(alongX?[sign*d,0,0]:[0,0,sign*d]);
          const interference=moving.intersect(box);
          expect(interference.volume(),`interference after ${d} mm`).toBeLessThan(0.001);
          moving.delete();interference.delete();
        }
        const raised=closed.translate([0,1.2,0]);made.push(raised);
        const retained=raised.intersect(box);made.push(retained);
        expect(retained.volume()).toBeGreaterThan(0.01);
        const overclosed=closed.translate(alongX?[-sign,0,0]:[0,0,-sign]);made.push(overclosed);
        const stopped=overclosed.intersect(box);made.push(stopped);expect(stopped.volume()).toBeGreaterThan(0.1);
      } finally {Array.from(new Set(made)).reverse().forEach(v=>v.delete?.());}
    });
  }
  it("ignores recessed roof settings and rejects ineffective bevels",async()=>{
    const {k,body}=await setup();
    try {
      const a=slidingLidParts(k,body,source,normalizeLidOptions({type:"sliding",slidingStyle:"flush",guideRoof:5}));
      const b=slidingLidParts(k,body,source,normalizeLidOptions({type:"sliding",slidingStyle:"flush",guideRoof:0.8}));
      if("error" in a || "error" in b) throw new Error("Flush failed");
      expect(a.plate.height).toEqual(b.plate.height);
      expect(a.cutters.map(c=>[c.elevation,c.height])).toEqual(b.cutters.map(c=>[c.elevation,c.height]));
      expect(slidingLidParts(k,body,source,normalizeLidOptions({type:"sliding",slidingStyle:"flush",gap:0.7}))).toHaveProperty("error");
    } finally {body.delete();}
  });
});


describe("configurable thumb grips: real geometry",()=>{
  for(const side of ["front","back","left","right"] as const) {
    for(const gripShape of ["circle","oval","roundedRectangle","slot"] as const) {
      for(const gripMode of ["recessed","raised"] as const) {
        it(`${side}: ${gripShape} ${gripMode} fits both styles and placements`,async()=>{
          const {k,body}=await setup();const made: {delete?:()=>void}[]=[body];
          try {
            const solid=(s:Parameters<typeof shapeToManifoldSolid>[1])=>shapeToManifoldSolid(k,s,made)!;
            for(const slidingStyle of ["recessed","flush"] as const) for(const gripPosition of ["inset","edge"] as const) {
              const options=normalizeLidOptions({type:"sliding",slidingStyle,openingSide:side,gripShape,gripMode,gripPosition,gripWidth:18,gripLength:6,gripCornerRadius:2,gripDepth:0.6});
              const result=slidingLidParts(k,body,source,options);
              if("error" in result || !result.grip) throw new Error("Missing grip");
              const plain=k.Manifold.union([result.plate,...(result.rails??[])].map(solid));made.push(plain);
              const grip=solid(result.grip);
              const lid=gripMode==="raised"?plain.add(grip):plain.subtract(grip);made.push(lid);
              expect(lid.status()).toBe("NoError");
              const components=lid.decompose();made.push(...components);expect(components).toHaveLength(1);
              expect(gripMode==="raised" ? lid.volume()>plain.volume():lid.volume()<plain.volume()).toBe(true);
              expect(lid.boundingBox().min[1]).toBeCloseTo(0,5);
              if(gripMode==="raised") expect(lid.boundingBox().max[1]).toBeCloseTo(2.6,4);
              else expect(result.grip.elevation).toBeGreaterThanOrEqual(0.4);
              const cuts=k.Manifold.union(result.cutters.map(solid));made.push(cuts);
              const modified=body.subtract(cuts);made.push(modified);
              const alongX=side==="left"||side==="right",negative=side==="front"||side==="left";
              const shiftX=alongX?40-(negative?-30:-27.8):slidingStyle==="flush"?40+27.8+0.8*2/2.4:68.6;
              const height=slidingStyle==="flush"?28:26.6;
              const closed=lid.translate([-shiftX,height,0]);made.push(closed);
              // Many positions include entry, closed and fully withdrawn; a raised grip
              // must clear the guides as well as the plate beneath it.
              for(let d=0;d<=70;d+=2) {
                const distance=(negative?-1:1)*d;
                const moving=closed.translate(alongX?[distance,0,0]:[0,0,distance]);
                const overlap=moving.intersect(modified);
                expect(overlap.volume()).toBeLessThan(0.001);
                moving.delete();overlap.delete();
              }
              const min=lid.boundingBox().min,max=lid.boundingBox().max;
              const across=alongX?2:0;
              expect(min[across]).toBeCloseTo(plain.boundingBox().min[across],4);
              expect(max[across]).toBeCloseTo(plain.boundingBox().max[across],4);
            }
          } finally {Array.from(new Set(made)).reverse().forEach(v=>v.delete?.());}
        });
      }
    }
  }
  it("limits oversized grips, corner radii, inset and deep recesses to the plate",async()=>{
    const {k,body}=await setup();
    try {
      for(const thickness of [0.4,2]) {
        const options=normalizeLidOptions({type:"sliding",thickness,gripShape:"roundedRectangle",gripWidth:100,gripLength:100,gripCornerRadius:25,gripInset:50,gripDepth:5});
        const result=slidingLidParts(k,body,source,options);
        if("error" in result || !result.grip) throw new Error("Missing grip");
        const g=result.grip;
        expect(g.elevation).toBeCloseTo(Math.min(0.4,2*thickness/3),5);
        expect(g.width!).toBeLessThan(result.plate.width!);
        expect(g.depth!).toBeLessThan(result.plate.depth!);
        expect(g.cornerFillet!).toBeLessThanOrEqual(Math.min(g.width!,g.depth!)/2);
      }
    } finally {body.delete();}
  });
});
