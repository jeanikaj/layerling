import type { ContainerGridOptions, WorkplaneShape } from "@/types/layerling";
import { sceneShape } from "@/lib/shapeCatalog";
import { getManifoldRuntime, type ManifoldSolid } from "@/lib/editorMeshCore";
import { buildGroupedShapeFromSelection, buildIntersectionShapeFromSelection, restoreGroupedChildren, shapeToManifoldSolid } from "@/lib/editorBooleans";
import { gridfinityCompartmentCount, gridfinityCompartmentMax, gridfinityDividerLimits, gridfinityDividerPositions, gridfinityDividerThickness } from "@/lib/gridfinityGeometry";
import { roundedRectangleRadius } from "@/lib/roundedSlidingLid";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import { t } from "@/lib/i18n";

export type { ContainerGridOptions } from "@/types/layerling";
import { customGridLayout, normalizeGridTree } from "@/lib/containerGridLayout";
export const CONTAINER_GRID_DEFAULTS: ContainerGridOptions = { columns: 2, rows: 4, thickness: 2, height: 0 };
/** Normalize external calls before the tray helpers enforce the available room. */
export function normalizeContainerGridOptions(value?: Partial<Record<keyof ContainerGridOptions, unknown>>): ContainerGridOptions {
  const number=(key:keyof ContainerGridOptions,fallback:number,min:number,max:number)=>typeof value?.[key]==="number"&&Number.isFinite(value[key])?Math.max(min,Math.min(max,value[key] as number)):fallback;
  const positions=(key:"positionsX"|"positionsZ")=>Array.isArray(value?.[key])?(value[key] as unknown[]).filter((v):v is number=>typeof v==="number"&&Number.isFinite(v)).slice(0,23):undefined;
  return { layout:value?.layout === "custom" ? "custom" : "grid", custom:normalizeGridTree(value?.custom), columns:Math.round(number("columns",2,1,24)),rows:Math.round(number("rows",4,1,24)),thickness:number("thickness",2,0.8,3),height:number("height",0,0,1000),positionsX:positions("positionsX"),positionsZ:positions("positionsZ"),removed:Array.isArray(value?.removed)?value.removed.filter((v):v is string=>typeof v==="string"&&/^[xz]:\d{1,2}:\d{1,2}$/.test(v)).slice(0,100):[] };
}
export type ContainerGridPlan = { xmin: number; xmax: number; zmin: number; zmax: number; outerXmin: number; outerXmax: number; outerZmin: number; outerZmax: number; outerRadius: number; bottom: number; floor: number; top: number; maxHeight: number };
export type GridSegment = { id: string; axis: "x" | "z"; position: number; from: number; to: number; removed: boolean };
export type ContainerGridResult = { plan: ContainerGridPlan; group?: WorkplaneShape; error?: never } | { error: string; plan?: never; group?: never };

/** Reuse tray spacing, minimum compartment widths and divider slider limits. No Gridfinity feet or walls are added. */
export function containerGridLayout(plan: ContainerGridPlan, options: ContainerGridOptions) {
  const fields = { width: plan.xmax-plan.xmin+2, depth: plan.zmax-plan.zmin+2, height: 20, gridfinityType: "tray" as const, gridfinityWallThickness: 1, gridfinityCompartmentsX: options.columns, gridfinityCompartmentsZ: options.rows, gridfinityDividerThickness: options.thickness, gridfinityDividerPositionsX: options.positionsX, gridfinityDividerPositionsZ: options.positionsZ };
  const columns=gridfinityCompartmentCount(fields,"x"),rows=gridfinityCompartmentCount(fields,"z"),thickness=gridfinityDividerThickness(fields);
  const xs=gridfinityDividerPositions(fields,"x"),zs=gridfinityDividerPositions(fields,"z");
  const width=plan.xmax-plan.xmin,depth=plan.zmax-plan.zmin;
  const removed=new Set(options.removed??[]),segments:GridSegment[]=[];
  const spans=(positions:number[],length:number)=>[0,...positions,length];
  const add=(axis:"x"|"z",positions:number[],cross:number[],length:number)=>positions.forEach((position,i)=>{
    const edges=spans(cross,length);
    for(let j=0;j<edges.length-1;j++) {const id=`${axis}:${i}:${j}`;segments.push({id,axis,position,from:edges[j],to:edges[j+1],removed:removed.has(id)});}
  });
  add("x",xs,zs,depth);add("z",zs,xs,width);
  const custom = customGridLayout(normalizeGridTree(options.custom), width, depth, thickness);
  if (options.layout === "custom") {
    segments.splice(0, segments.length, ...custom.divisions.map(d => ({ id: d.id, axis: d.axis, position: d.position, from: d.from, to: d.to, removed: false })));
  }
  const height=Number.isFinite(options.height)&&options.height>0?Math.min(plan.maxHeight,Math.max(1,options.height)):plan.maxHeight;
  return {columns,rows,thickness,xs,zs,width,depth,height,segments,custom,maxColumns:gridfinityCompartmentMax(fields,"x"),maxRows:gridfinityCompartmentMax(fields,"z"),limits:(axis:"x"|"z",i:number)=>gridfinityDividerLimits(fields,axis,i)};
}

export function savedContainerGridOptions(shape: WorkplaneShape): ContainerGridOptions | null {
  if (shape.containerGrid?.version === 1) return normalizeContainerGridOptions(shape.containerGrid.options);
  if (shape.groupOperation && shape.groupOperation !== "group") return null;
  for (const child of shape.groupedShapes ?? []) {
    const found = savedContainerGridOptions(child);
    if (found) return found;
  }
  return null;
}

/** Remove only the generated grid, preserving scoped container holes and later lid cuts. */
async function containerWithoutGrid(shape: WorkplaneShape, triangleLimit: number): Promise<WorkplaneShape> {
  if (shape.containerGrid?.version === 1) {
    if (!shape.containerGrid.sourceId) return canonicalizeShape({ ...shape, containerGrid: undefined });
    const children = restoreGroupedChildren(shape);
    const sourceIndex = shape.groupedShapes?.findIndex(child => child.id === shape.containerGrid!.sourceId) ?? -1;
    const source = children[sourceIndex];
    if (!source) throw new Error("Missing container grid source");
    return source;
  }
  if (!shape.groupedShapes?.length || (shape.groupOperation && shape.groupOperation !== "group") || !savedContainerGridOptions(shape)) return shape;
  const children = await Promise.all(restoreGroupedChildren(shape).map(child => containerWithoutGrid(child, triangleLimit)));
  const rebuilt = await buildGroupedShapeFromSelection(children, triangleLimit);
  if (!rebuilt.group) throw new Error(rebuilt.failureNotice);
  return canonicalizeShape({ ...rebuilt.group, name: shape.name, groupOperation: "group" });
}

/** Read one empty, upright rectangular cavity below the lid guides. All CAD work also runs in the geometry worker. */
export async function containerGridForShape(target:WorkplaneShape, options:ContainerGridOptions=CONTAINER_GRID_DEFAULTS, build=false, triangleLimit=500000):Promise<ContainerGridResult> {
  const name = target.name;
  options=normalizeContainerGridOptions(options);
  const made:ManifoldSolid[]=[];
  try {
    target = await containerWithoutGrid(target, triangleLimit);
    const runtime=await getManifoldRuntime();
    const body=shapeToManifoldSolid(runtime,target,made);
    const fail=()=>({error:t("containerGrid.error.opening")});
    if(!body || body.status()!=="NoError" || body.numTri()===0 || target.hole || target.groupOperation==="bundle") return fail();
    const bounds=body.boundingBox(),top=bounds.max[1],bottom=bounds.min[1];
    const sample=top-Math.min(5,(top-bottom)/4);
    const up=body.rotate([90,0,0]);made.push(up);
    const section=up.slice(sample);
    let plan:ContainerGridPlan;
    try {
      const polys=section.toPolygons() as [number,number][][];
      const area=(p:[number,number][])=>p.reduce((s,[x,z],i)=>{const n=p[(i+1)%p.length];return s+x*n[1]-n[0]*z;},0)/2;
      const outers=polys.filter(p=>area(p)>0),holes=polys.filter(p=>area(p)<0);
      if(outers.length!==1||holes.length!==1) return fail();
      const world=(p:[number,number][])=>p.map(([x,z])=>[x,-z] as [number,number]);
      const inner=world(holes[0]),outer=world(outers[0]);
      const radius=roundedRectangleRadius(inner),outerRadius=roundedRectangleRadius(outer);
      if(radius===null||outerRadius===null) return fail();
      const extent=(p:[number,number][])=>({xmin:Math.min(...p.map(v=>v[0])),xmax:Math.max(...p.map(v=>v[0])),zmin:Math.min(...p.map(v=>v[1])),zmax:Math.max(...p.map(v=>v[1]))});
      const inside=extent(inner),outside=extent(outer);
      if(Math.min(inside.xmax-inside.xmin,inside.zmax-inside.zmin)<8) return fail();
      // A central probe finds the floor without confusing rounded lower wall corners with the floor.
      const cx=(inside.xmin+inside.xmax)/2,cz=(inside.zmin+inside.zmax)/2;
      const probe=runtime.Manifold.cube([0.5,sample-bottom,0.5]).translate([cx-0.25,bottom,cz-0.25]);made.push(probe);
      const floorBody=body.intersect(probe);made.push(floorBody);
      if(floorBody.numTri()===0) return fail();
      const floor=floorBody.boundingBox().max[1],maxHeight=top-5-floor;
      if(maxHeight<1) return fail();
      // Refuse existing dividers/contents in the central straight portion of the cavity.
      const margin=Math.min(radius+0.2,(Math.min(inside.xmax-inside.xmin,inside.zmax-inside.zmin)-1)/2);
      const check=runtime.Manifold.cube([inside.xmax-inside.xmin-2*margin,top-floor-0.2,inside.zmax-inside.zmin-2*margin]).translate([inside.xmin+margin,floor+0.2,inside.zmin+margin]);made.push(check);
      const obstruction=check.intersect(body);made.push(obstruction);
      if(obstruction.volume()>0.02) return fail();
      plan={...inside,outerXmin:outside.xmin,outerXmax:outside.xmax,outerZmin:outside.zmin,outerZmax:outside.zmax,outerRadius,bottom,floor,top,maxHeight};
    } finally {section.delete();}
    if(!build) return {plan};
    const layout=containerGridLayout(plan,options),segments=layout.segments.filter(s=>!s.removed);
    if(options.layout === "custom" && !layout.custom.valid) return {error:t("containerGrid.error.layout")};
    if(!segments.length) return {plan,group:canonicalizeShape({...target,name,containerGrid:{version:1,sourceId:"",options}})};
    const start=bottom+Math.min(0.1,(plan.floor-bottom)/2),height=plan.floor+layout.height-start;
    if(height<=0||plan.floor-bottom<0.1) return fail();
    const base={color:target.color,elevation:start,height,rotation:0};
    const strips=segments.map(s=>{
      const alongX=s.axis==="x",span=s.to-s.from+layout.thickness;
      return sceneShape({...base,name:t("containerGrid.divider"),kind:"box",x:plan.xmin+(alongX?s.position:(s.from+s.to)/2),z:plan.zmin+(alongX?(s.from+s.to)/2:s.position),width:alongX?layout.thickness:span,depth:alongX?span:layout.thickness});
    });
    const union=await buildGroupedShapeFromSelection(strips,triangleLimit);
    if(!union.group) return {error:union.failureNotice||t("containerGrid.error.build")};
    // Clip to an inset of the original outside wall: rounded corner ends join the wall without protruding.
    const inset=0.3;
    const envelope=sceneShape({...base,name:t("containerGrid.envelope"),kind:"roundedBox",x:(plan.outerXmin+plan.outerXmax)/2,z:(plan.outerZmin+plan.outerZmax)/2,width:plan.outerXmax-plan.outerXmin-2*inset,depth:plan.outerZmax-plan.outerZmin-2*inset,cornerFillet:Math.max(0,plan.outerRadius-inset),topBottomFillet:0,roundedBoxQuality:24});
    const clipped=await buildIntersectionShapeFromSelection([union.group,envelope],triangleLimit);
    if(!clipped.group) return {error:clipped.failureNotice||t("containerGrid.error.build")};
    const grid=canonicalizeShape({...clipped.group,name:t("containerGrid.title"),groupOperation:"intersection"});
    const gridSolid=shapeToManifoldSolid(runtime,grid,made);
    if(!gridSolid) return fail();
    const hull=body.hull();made.push(hull);
    const escaped=gridSolid.subtract(hull);made.push(escaped);
    // A large lower-edge fillet can narrow the outside below the sampled rim.
    if(escaped.volume()>0.02) return {error:t("containerGrid.error.connected")};
    // Keep the original cavity cutters scoped to the original body, so they cannot cut away the new grid.
    const combined=await buildGroupedShapeFromSelection([target,grid],triangleLimit);
    if(!combined.group) return {error:combined.failureNotice||t("containerGrid.error.build")};
    const result=canonicalizeShape({...combined.group,name,groupOperation:"group",containerGrid:{version:1,sourceId:combined.group.groupedShapes![0].id,options}});
    const solid=shapeToManifoldSolid(runtime,result,made);
    if(!solid||solid.status()!=="NoError") return {error:t("containerGrid.error.build")};
    const parts=solid.decompose();made.push(...parts);
    if(parts.length!==1) return {error:t("containerGrid.error.connected")};
    return {plan,group:result};
  } catch {return {error:t("containerGrid.error.build")};}
  finally {Array.from(new Set(made)).reverse().forEach(s=>s.delete());}
}
