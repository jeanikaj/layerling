import {describe,it,expect} from "vitest";
import {containerGridLayout,normalizeContainerGridOptions,CONTAINER_GRID_DEFAULTS,type ContainerGridPlan} from "@/lib/containerGrid";
const plan:ContainerGridPlan={xmin:0,xmax:102,zmin:0,zmax:182,outerXmin:-4,outerXmax:106,outerZmin:-4,outerZmax:186,outerRadius:20,bottom:0,floor:2,top:50,maxHeight:43};
describe("container grid layout",()=>{
 it("defaults to eight equal clear compartments and ten individually removable divider sections",()=>{
  const grid=containerGridLayout(plan,CONTAINER_GRID_DEFAULTS);
  expect([grid.columns,grid.rows]).toEqual([2,4]);expect(grid.xs).toEqual([51]);expect(grid.zs).toEqual([45,91,137]);
  expect(grid.segments).toHaveLength(10);expect(new Set(grid.segments.map(s=>s.id)).size).toBe(10);expect(grid.height).toBe(43);
 });
 it("reuses minimum clear widths, clamps crossed custom dividers and keeps at most forty cells",()=>{
  const grid=containerGridLayout(plan,{...CONTAINER_GRID_DEFAULTS,columns:24,rows:24,positionsZ:[0,0,0]});
  expect(grid.columns*grid.rows).toBeLessThanOrEqual(40);
  for(const [positions,length] of [[grid.xs,grid.width],[grid.zs,grid.depth]] as const){const edges=[-grid.thickness/2,...positions,length+grid.thickness/2];for(let i=1;i<edges.length;i++)expect(edges[i]-edges[i-1]-grid.thickness).toBeGreaterThanOrEqual(6-1e-8);}
 });
 it("keeps partial merges independent of custom spacing and caps the divider top",()=>{
  const grid=containerGridLayout(plan,{...CONTAINER_GRID_DEFAULTS,positionsX:[30],removed:["x:0:1"],height:1000});
  expect(grid.xs).toEqual([30]);expect(grid.segments.filter(s=>s.removed).map(s=>s.id)).toEqual(["x:0:1"]);expect(grid.height).toBe(43);
 });
 it("normalizes external options without non-finite dimensions or invalid segment keys",()=>{
  expect(normalizeContainerGridOptions({columns:Infinity,rows:3.6,thickness:-2,height:NaN,positionsX:[1,NaN,"bad"],removed:["x:0:0","bogus",null]})).toMatchObject({columns:2,rows:4,thickness:0.8,height:0,positionsX:[1],removed:["x:0:0"]});
 });
});

import {customGridLayout,changeGridNode,normalizeGridTree} from "@/lib/containerGridLayout";
describe("independent compartment splits",()=>{
 it("resizes one branch without moving the other branch and clamps child minimum widths",()=>{
  const tree=normalizeGridTree({id:"root",split:{axis:"x",ratio:0.5,first:{id:"left",split:{axis:"z",ratio:0.3,first:{id:"a"},second:{id:"b"}}},second:{id:"right",split:{axis:"z",ratio:0.6,first:{id:"c"},second:{id:"d"}}}}});
  const before=customGridLayout(tree,100,100,2);
  const moved=customGridLayout(changeGridNode(tree,"left",n=>({...n,split:{...n.split!,ratio:0.9}})),100,100,2);
  expect(moved.divisions.find(d=>d.id==="right")).toEqual(before.divisions.find(d=>d.id==="right"));
  expect(moved.divisions.find(d=>d.id==="left")!.position).toBeGreaterThan(before.divisions.find(d=>d.id==="left")!.position);
  const clamped=customGridLayout(changeGridNode(tree,"root",n=>({...n,split:{...n.split!,ratio:0}})),100,100,2);
  expect(clamped.cells.every(c=>c.xmax-c.xmin>=6&&c.zmax-c.zmin>=6)).toBe(true);
  expect(customGridLayout(changeGridNode(tree,"left",n=>({id:n.id})),100,100,2).cells).toHaveLength(3);
 });
 it("rejects layouts too small for their descendants",()=>{
  const tree=normalizeGridTree({split:{axis:"x",first:{},second:{}}});
  expect(customGridLayout(tree,10,100,2).valid).toBe(false);
 });
});
