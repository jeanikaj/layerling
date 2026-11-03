import {describe,it,expect} from "vitest";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {sceneShape} from "@/lib/shapeCatalog";
import {buildGroupedShapeFromSelection,shapeToManifoldSolid,restoreGroupedChildren} from "@/lib/editorBooleans";
import {getManifoldRuntime,type ManifoldSolid} from "@/lib/editorMeshCore";
import {containerGridForShape,containerGridLayout,CONTAINER_GRID_DEFAULTS} from "@/lib/containerGrid";
import {lidForShapes,normalizeLidOptions} from "@/lib/lidTool";
import type {WorkplaneShape} from "@/types/layerling";
(globalThis as unknown as {window:unknown}).window={location:{href:pathToFileURL(resolve("apps/web/public")+"/").href}};

async function tray(radius=6,width=60,depth=40) {
 const base=sceneShape({id:"grid-tray",name:"Grid tray",kind:"roundedBox",color:"#aa3333",width,depth,height:30,x:10,z:-7,elevation:3,cornerFillet:radius,topBottomFillet:0,roundedBoxQuality:24});
 const hole=sceneShape({...base,id:"grid-hole",name:"Cavity",width:width-4.4,depth:depth-4.4,height:30,elevation:5,cornerFillet:Math.max(0,radius-2.2),hole:true});
 const result=await buildGroupedShapeFromSelection([base,hole],500000);
 if(!result.group)throw new Error(result.failureNotice);return result.group;
}
const noError=(r:Awaited<ReturnType<typeof containerGridForShape>>)=>{if(r.error)throw new Error(r.error);return r;};

describe("custom grids in existing containers",()=>{
 for(const radius of [0,6,16]) it(`joins a 2 by 4 grid to a ${radius} mm rounded tray without changing its outside or rim`,async()=>{
  const target=await tray(radius,110,190),result=noError(await containerGridForShape(target,CONTAINER_GRID_DEFAULTS,true));
  expect(result.plan.floor).toBeCloseTo(5,2);expect(result.group).toBeTruthy();
  const k=await getManifoldRuntime(),made:ManifoldSolid[]=[];
  try {
   const before=shapeToManifoldSolid(k,target,made)!,after=shapeToManifoldSolid(k,result.group!,made)!;
   const hull=before.hull(),outside=after.subtract(hull);made.push(hull,outside);expect(outside.volume()).toBeLessThan(0.01);
   const top=k.Manifold.cube([200,5,300]).translate([-90,28,-150]);made.push(top);
   const changed=after.subtract(before),rim=changed.intersect(top);made.push(changed,rim);expect(rim.volume()).toBeLessThan(0.001);
   const parts=after.decompose();made.push(...parts);expect(parts).toHaveLength(1);expect(after.volume()).toBeGreaterThan(before.volume()+1000);
   const rotated=after.rotate([90,0,0]);made.push(rotated);const section=rotated.slice(15);
   const polygons=section.toPolygons();section.delete();
   const area=(p:number[][])=>p.reduce((s,v,i)=>{const n=p[(i+1)%p.length];return s+v[0]*n[1]-n[0]*v[1];},0);
   expect(polygons.filter(p=>area(p)<0)).toHaveLength(8);
   expect(restoreGroupedChildren(result.group!).some(s=>s.name===target.name)).toBe(true);
  } finally {Array.from(new Set(made)).reverse().forEach(s=>s.delete());}
 });
 it("removes individual divider sections to merge cells and retains custom spacing",async()=>{
  const target=await tray(6,110,190),options={...CONTAINER_GRID_DEFAULTS,positionsX:[35],positionsZ:[30,80,135],removed:["x:0:0"]};
  const result=noError(await containerGridForShape(target,options,true));
  const layout=containerGridLayout(result.plan,options);expect(layout.xs).toEqual([35]);expect(layout.zs).toEqual([30,80,135]);
  const k=await getManifoldRuntime(),made:ManifoldSolid[]=[];
  try{const body=shapeToManifoldSolid(k,result.group!,made)!,up=body.rotate([90,0,0]);made.push(up);const section=up.slice(15);const polys=section.toPolygons();section.delete();expect(polys).toHaveLength(8);}finally{Array.from(new Set(made)).reverse().forEach(s=>s.delete());}
 });
 for(const style of ["recessed","flush"] as const) it(`allows a ${style} sliding lid after adding a grid`,async()=>{
  const gridded=noError(await containerGridForShape(await tray(),{...CONTAINER_GRID_DEFAULTS,rows:2},true));
  const lid=await lidForShapes([gridded.group!],normalizeLidOptions({type:"sliding",slidingStyle:style,clickStop:true}));
  expect(lid.lid,"error" in lid?lid.error:"").toBeTruthy();expect(lid).toHaveProperty("sliding");
 });
 it("accepts an existing sliding box and preserves its guide cuts",async()=>{
  const target=await tray(),lid=await lidForShapes([target],normalizeLidOptions({type:"sliding",slidingStyle:"flush",clickStop:false}));
  if(!lid.lid||!lid.sliding)throw new Error("No lid");
  const grouped=await buildGroupedShapeFromSelection([target,...lid.sliding.cutters],500000);expect(grouped.group).toBeTruthy();
  expect(noError(await containerGridForShape(grouped.group!,CONTAINER_GRID_DEFAULTS,true)).group).toBeTruthy();
 });
 it("refuses closed and tilted bodies, but can replace or clear its own grid",async()=>{
  const solid=sceneShape({name:"Closed",kind:"box",color:"#aaa",width:60,depth:40,height:30});
  expect(await containerGridForShape(solid)).toHaveProperty("error");
  const target=await tray(),divided=noError(await containerGridForShape(target,CONTAINER_GRID_DEFAULTS,true));
  expect(noError(await containerGridForShape(divided.group!)).plan).toBeTruthy();
  expect(await containerGridForShape({...target,rotationX:20})).toHaveProperty("error");
  const cleared=noError(await containerGridForShape(divided.group!,{...CONTAINER_GRID_DEFAULTS,rows:1,columns:1},true));
  const k=await getManifoldRuntime(),made:ManifoldSolid[]=[];
  try {expect(shapeToManifoldSolid(k,cleared.group!,made)!.volume()).toBeCloseTo(shapeToManifoldSolid(k,target,made)!.volume(),3);}finally{Array.from(new Set(made)).reverse().forEach(s=>s.delete());}
 });
});

it("rebuilds a persisted asymmetric layout without accumulating old walls",async()=>{
 const custom={id:"root",split:{axis:"z" as const,ratio:0.5,first:{id:"top",split:{axis:"x" as const,ratio:0.5,first:{id:"left",split:{axis:"z" as const,ratio:0.5,first:{id:"a"},second:{id:"b"}}},second:{id:"c"}}},second:{id:"lower",split:{axis:"z" as const,ratio:0.5,first:{id:"middle"},second:{id:"bottom",split:{axis:"x" as const,ratio:0.5,first:{id:"d"},second:{id:"e"}}}}}}};
 const target=await tray(6,110,190),options={...CONTAINER_GRID_DEFAULTS,layout:"custom" as const,custom};
 const first=noError(await containerGridForShape(target,options,true));
 const {exportLylProject,importLylProject}=await import("@/lib/lylProject");
 const {DEFAULT_WORKPLANE_WORKSPACE}=await import("@/lib/workplaneSettings");
 const shapes=[first.group!];
 const bytes=await exportLylProject({projectId:"grid-roundtrip",projectName:"Custom grid",createdAt:1,modifiedAt:2,shapes,history:[],historyIndex:0,assets:[],workspace:DEFAULT_WORKPLANE_WORKSPACE,snapGrid:1,placementElevation:0});
 const persisted=(await importLylProject(bytes)).shapes[0];
 expect(persisted.containerGrid?.options.custom).toEqual(custom);
 const second=noError(await containerGridForShape(persisted,options,true));
 const k=await getManifoldRuntime(),made:ManifoldSolid[]=[];
 try {
  const a=shapeToManifoldSolid(k,first.group!,made)!,b=shapeToManifoldSolid(k,second.group!,made)!;
  expect(b.volume()).toBeCloseTo(a.volume(),3);expect(b.decompose().map(s=>{s.delete();return 1;})).toHaveLength(1);
  const rotated=b.rotate([90,0,0]);made.push(rotated);const section=rotated.slice(15);expect(section.toPolygons()).toHaveLength(7);section.delete();
 }finally{Array.from(new Set(made)).reverse().forEach(s=>s.delete());}
});

it("preserves later sliding lid cuts when changing or clearing a generated grid",async()=>{
 const target=await tray(),first=noError(await containerGridForShape(target,CONTAINER_GRID_DEFAULTS,true));
 const lid=await lidForShapes([first.group!],normalizeLidOptions({type:"sliding",slidingStyle:"flush",clickStop:true}));
 if(!lid.lid||!lid.sliding)throw new Error("No lid");
 const wrapped=await buildGroupedShapeFromSelection([first.group!,...lid.sliding.cutters],500000);
 expect(wrapped.group).toBeTruthy();
 const cleared=noError(await containerGridForShape(wrapped.group!,{...CONTAINER_GRID_DEFAULTS,columns:1,rows:1},true));
 const expected=await buildGroupedShapeFromSelection([target,...lid.sliding.cutters],500000);
 const k=await getManifoldRuntime(),made:ManifoldSolid[]=[];
 try {const a=shapeToManifoldSolid(k,cleared.group!,made)!,b=shapeToManifoldSolid(k,expected.group!,made)!;const difference=a.subtract(b);made.push(difference);expect(difference.volume()).toBeLessThan(0.01);expect(a.volume()).toBeCloseTo(b.volume(),2);}finally{Array.from(new Set(made)).reverse().forEach(s=>s.delete());}
 expect(noError(await containerGridForShape(wrapped.group!,{...CONTAINER_GRID_DEFAULTS,rows:2},true)).group).toBeTruthy();
});

for(const [columns,rows] of [[1,2],[2,1]]) for(const custom of [false,true]) it(`builds ${columns} by ${rows} compartments with a single ${custom?"custom":"regular"} divider`,async()=>{
 const target=await tray(),options={...CONTAINER_GRID_DEFAULTS,columns,rows,...(custom?{layout:"custom" as const,custom:{id:"root",split:{axis:columns===2?"x" as const:"z" as const,ratio:0.5,first:{id:"a"},second:{id:"b"}}}}:{})};
 const first=noError(await containerGridForShape(target,options,true));
 const revised=noError(await containerGridForShape(first.group!,options,true));
 const k=await getManifoldRuntime(),made:ManifoldSolid[]=[];
 try {
  const body=shapeToManifoldSolid(k,revised.group!,made)!;
  const parts=body.decompose();made.push(...parts);expect(parts).toHaveLength(1);
  const up=body.rotate([90,0,0]);made.push(up);const section=up.slice(15);try{expect(section.toPolygons()).toHaveLength(3);}finally{section.delete();}
  expect(body.volume()).toBeCloseTo(shapeToManifoldSolid(k,first.group!,made)!.volume(),3);
 }finally{Array.from(new Set(made)).reverse().forEach(s=>s.delete());}
});
