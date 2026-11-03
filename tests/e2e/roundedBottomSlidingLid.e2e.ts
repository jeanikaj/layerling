import {beforeAll,describe,it,expect} from "vitest";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {OcctKernel,type ShapeHandle} from "occt-wasm";
import Module from "manifold-3d";
import {meshTreatedBody} from "@/lib/cadMeshAccuracy";
import {shellSolid} from "@/lib/cadShell";
import {sceneShape} from "@/lib/shapeCatalog";
import {shapeToManifoldSolid} from "@/lib/editorBooleans";
import {slidingLidParts} from "@/lib/slidingLid";
import {normalizeLidOptions} from "@/lib/lidTool";
(globalThis as unknown as {window:unknown}).window={location:{href:pathToFileURL(resolve("apps/web/public")+"/").href}};
let cad:OcctKernel;
beforeAll(async()=>{cad=await OcctKernel.init({wasm:join(dirname(fileURLToPath(import.meta.resolve("occt-wasm"))),"occt-wasm.wasm")});});

// Real CAD operations used by Fillet -> Bottom edges and Hollow, rather than
// a proxy shape that merely looks rounded in plan view.
describe("bottom-only fillets with rounded sliding containers",()=>{
 for(const order of ["before hollow","after hollow"] as const) for(const radius of [0.5,1,2,3]) for(const style of ["recessed","flush"] as const) {
  it(`${radius} mm bottom fillet ${order}, ${style}: valid body and unobstructed lid travel`,async()=>{
   const handles:ShapeHandle[]=[],k=await Module();k.setup();const made:{delete?:()=>void}[]=[];
   const keep=(s:ShapeHandle)=>{handles.push(s);return s;};
   const edges=(s:ShapeHandle,pick:(b:ReturnType<OcctKernel["getBoundingBox"]>)=>boolean)=>{
    const all=cad.getSubShapes(s,"edge");handles.push(...all);return all.filter(e=>pick(cad.getBoundingBox(e,false)));
   };
   try {
    const block=keep(cad.makeBox(60,30,40));
    let rounded=keep(cad.fillet(block,edges(block,b=>b.ymax-b.ymin>29),6));
    if(order==="after hollow") rounded=keep(shellSolid(cad,rounded,2,"top"));
    rounded=keep(cad.fillet(rounded,edges(rounded,b=>Math.abs(b.ymin)<1e-5&&Math.abs(b.ymax)<1e-5),radius));
    if(order==="before hollow") rounded=keep(shellSolid(cad,rounded,2,"top"));
    expect(cad.isValid(rounded)).toBe(true);expect(cad.subShapeCount(rounded,"solid")).toBe(1);
    const centered=keep(cad.translate(rounded,-30,0,-20));
    const deflection={linear:0.01,angular:0.08};
    const meshed=meshTreatedBody(cad,[centered],centered,deflection,deflection);
    if(meshed.result!==centered) handles.push(meshed.result);
    const mesh=meshed.mesh;
    const m=new k.Mesh({numProp:3,vertProperties:new Float32Array(mesh.positions),triVerts:new Uint32Array(mesh.indices),tolerance:0.0001});m.merge();
    const body=new k.Manifold(m);made.push(body);expect(body.status()).toBe("NoError");
    const source=sceneShape({id:"rounded-bottom",name:"Bottom-rounded tray",kind:"roundedBox",x:0,z:0,elevation:0,width:60,depth:40,height:30,cornerFillet:6,topBottomFillet:0});
    const result=slidingLidParts(k,body,source,normalizeLidOptions({type:"sliding",slidingStyle:style,thumbGrip:false,clickStop:true}));
    if("error" in result) throw new Error(result.error);
    const solid=(s:Parameters<typeof shapeToManifoldSolid>[1])=>shapeToManifoldSolid(k,s,made)!;
    const cuts=k.Manifold.union(result.cutters.map(solid));made.push(cuts);
    const box=body.subtract(cuts);made.push(box);
    expect(box.status()).toBe("NoError");const parts=box.decompose();made.push(...parts);expect(parts).toHaveLength(1);
    expect(result.bodyAdditions).toHaveLength(2);expect(result.lidAdditions).toHaveLength(4);
    const reliefs=k.Manifold.union(result.lidAdditions!.map(solid)),bumps=k.Manifold.union(result.bodyAdditions!.map(solid));made.push(reliefs,bumps);
    const lid=solid(result.plate).subtract(reliefs);made.push(lid);
    const flush=style==="flush",B=flush?0.8*2/2.4:0;
    // Use measured bounds: shelling a tight fillet can change the base bounds.
    const bounds=body.boundingBox();
    const closed=lid.translate([-(bounds.max[0]+10+28-(flush?0.2:-0.6)+B),(flush?28:26.6)-bounds.min[1],0]);made.push(closed);
    const retained=box.add(bumps),seated=closed.intersect(retained);made.push(retained,seated);expect(seated.volume()).toBeLessThan(0.005);
    for(let d=0;d<=70;d+=0.5){const moving=closed.translate([0,0,-d]),overlap=moving.intersect(box);expect(overlap.volume(),`interference at ${d} mm`).toBeLessThan(0.005);moving.delete();overlap.delete();}
   }finally{Array.from(new Set(made)).reverse().forEach(v=>v.delete?.());handles.reverse().forEach(h=>cad.release(h));}
  });
 }
});
