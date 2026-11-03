import {describe,it,expect,vi} from "vitest";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
(globalThis as unknown as {window:unknown}).window={location:{href:pathToFileURL(resolve("apps/web/public")+"/").href}};
vi.mock("@/lib/brepKernel",async()=>{
 const brep=await import("brepjs"),{OcctKernel}=await import("occt-wasm");
 let ready:Promise<typeof brep>|null=null,raw:Awaited<ReturnType<typeof OcctKernel.init>>|null=null;
 return {occtKernel:()=>raw,loadBrepWithOcct:()=>ready??=(async()=>{raw=await OcctKernel.init({wasm:join(dirname(fileURLToPath(import.meta.resolve("occt-wasm"))),"occt-wasm.wasm")});brep.registerKernel("occt-wasm",brep.OcctWasmAdapter.fromKernel(raw));return brep;})()};
});
describe("native container grid export",()=>{
 it("round trips the complete box and custom grid through STEP with no skipped parts",async()=>{
  const {sceneShape}=await import("@/lib/shapeCatalog"),{buildGroupedShapeFromSelection,shapeToManifoldSolid}=await import("@/lib/editorBooleans");
  const {containerGridForShape,CONTAINER_GRID_DEFAULTS}=await import("@/lib/containerGrid");
  const {getManifoldRuntime}=await import("@/lib/editorMeshCore"),{loadBrepWithOcct}=await import("@/lib/brepKernel");
  const brep=await loadBrepWithOcct();
  const outer=sceneShape({name:"Box",kind:"roundedBox",color:"#aa3333",width:70,depth:100,height:30,cornerFillet:10,topBottomFillet:0,roundedBoxQuality:24});
  const hole=sceneShape({...outer,name:"Opening",width:66,depth:96,height:30,elevation:2,hole:true,cornerFillet:8});
  const target=await buildGroupedShapeFromSelection([outer,hole],500000);expect(target.group).toBeTruthy();
  const result=await containerGridForShape(target.group!,{...CONTAINER_GRID_DEFAULTS,positionsX:[25],removed:["x:0:0"]},true);
  if(!result.group)throw new Error(result.error);
  const {exportShapesToStep}=await import("@/lib/stepExport"),exported=await exportShapesToStep([result.group]);
  expect(exported.skipped).toEqual([]);expect(exported.exportedCount).toBeGreaterThan(0);
  const read=await brep.importSTEP(exported.blob);
  if(!read.ok)throw new Error("STEP import failed");
  const fused=brep.fuseAll(brep.getSolids(read.value) as Parameters<typeof brep.fuseAll>[0]);if(!fused.ok)throw new Error("STEP parts could not be joined");
  const volume=brep.measureVolume(fused.value);if(!volume.ok)throw new Error("STEP volume unavailable");
  const k=await getManifoldRuntime(),made:import("@/lib/editorMeshCore").ManifoldSolid[]=[];
  try{const mesh=shapeToManifoldSolid(k,result.group,made)!;expect(Math.abs(volume.value-mesh.volume())/mesh.volume()).toBeLessThan(0.005);}finally{Array.from(new Set(made)).reverse().forEach(s=>s.delete());}
 });
});
