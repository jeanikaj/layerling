import type { ManifoldToplevel } from "manifold-3d";
import type { ManifoldSolid } from "@/lib/editorMeshCore";
import { shapeToManifoldSolid } from "@/lib/editorBooleans";
import { sceneShape } from "@/lib/shapeCatalog";
import { createLocalId } from "@/lib/localIds";
import { loftFrameSize, loftStoredMeasures } from "@/lib/loftGeometry";
import { slidingThumbGrip } from "@/lib/slidingThumbGrip";
import { slidingDetent } from "@/lib/slidingDetent";
import { t } from "@/lib/i18n";
import type { LidOptions } from "@/lib/lidTool";
import type { WorkplaneShape } from "@/types/layerling";

type Point = [number,number];
/** Recognise axis-aligned circular corner arcs, rather than treating any outline
 * with a rounded-looking area as a rectangle. Cardinal tangencies give the radius;
 * every vertex and the polygon area must agree with that rounded rectangle.
 */
export function roundedRectangleRadius(points: Point[]): number | null {
  const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);
  const xmin=Math.min(...xs),xmax=Math.max(...xs),zmin=Math.min(...zs),zmax=Math.max(...zs);
  const w=xmax-xmin,d=zmax-zmin,cx=(xmin+xmax)/2,cz=(zmin+zmax)/2;
  const edge=(axis:number,value:number,other:number)=>points.filter(p=>Math.abs(p[axis]-value)<0.001).map(p=>p[other]);
  const candidates=[...[-1,1].flatMap(sign=>{
    const z=edge(0,sign<0?xmin:xmax,1),x=edge(1,sign<0?zmin:zmax,0);
    return [d/2-Math.max(...z.map(v=>Math.abs(v-cz))),w/2-Math.max(...x.map(v=>Math.abs(v-cx)))];
  })];
  const radius=Math.max(0,candidates.reduce((sum,v)=>sum+v,0)/candidates.length);
  if(!Number.isFinite(radius) || candidates.some(v=>Math.abs(v-radius)>0.08)) return null;
  const distance=([x,z]:Point)=>{
    const qx=Math.abs(x-cx)-(w/2-radius),qz=Math.abs(z-cz)-(d/2-radius);
    return Math.hypot(Math.max(qx,0),Math.max(qz,0))+Math.min(Math.max(qx,qz),0)-radius;
  };
  if(points.some(p=>Math.abs(distance(p))>0.08)) return null;
  const area=Math.abs(points.reduce((s,p,i)=>{const n=points[(i+1)%points.length];return s+p[0]*n[1]-n[0]*p[1];},0)/2);
  if(Math.abs(area-(w*d-(4-Math.PI)*radius*radius))>Math.max(0.08,Math.PI*radius*radius*0.015)) return null;
  return Math.round(radius*100)/100;
}

/** A swept rounded guide has its entry-end corners beyond the container. Its
 * far end follows the rounded opening. This keeps the entire sliding path clear,
 * unlike rounding a closed pocket and then pushing a wide lid through its corners.
 * Rounded native lofts preserve the exact CAD/STEP reconstruction path.
 */
export function roundedSlidingLidParts(runtime:ManifoldToplevel,body:ManifoldSolid,source:WorkplaneShape,options:LidOptions,opening:{xmin:number;xmax:number;zmin:number;zmax:number;radius:number;low:number;high:number},bounds:ReturnType<ManifoldSolid["boundingBox"]>):
 {plate:WorkplaneShape;grip?:WorkplaneShape;lidAdditions?:WorkplaneShape[];bodyAdditions?:WorkplaneShape[];cutters:WorkplaneShape[]} | {error:string} {
  const made:ManifoldSolid[]=[];
  const fail=(key:"radius"|"shape"|"grip")=>({error:t(`lid.rounded.error.${key}`)});
  try {
    const alongX=options.openingSide==="left"||options.openingSide==="right";
    const negative=(options.openingSide??"front")==="front"||options.openingSide==="left";
    const a=alongX?0:2,cross=alongX?2:0,sign=negative?1:-1;
    const innerMin=[opening.xmin,opening.low,opening.zmin],innerMax=[opening.xmax,opening.high,opening.zmax];
    const width=innerMax[cross]-innerMin[cross],length=innerMax[a]-innerMin[a];
    const radius=opening.radius,E=options.engagement??0.8,gap=options.gap,v=options.verticalGap??0.2;
    const flush=options.slidingStyle==="flush",thickness=options.thickness;
    if(innerMin[cross]-bounds.min[cross]<E+1.2-1e-5 || bounds.max[cross]-innerMax[cross]<E+1.2-1e-5 || innerMin[a]-bounds.min[a]<E+1.2-1e-5 || bounds.max[a]-innerMax[a]<E+1.2-1e-5) return fail("shape");
    const matched=Math.max(0,radius+(flush?0:E)-gap);
    const corner=options.cornerMode==="custom" ? options.lidCornerRadius??6 : matched;
    const topWidth=width+2*(flush?-gap:E-gap);
    const entry=negative?bounds.min[a]:bounds.max[a];
    const far=negative?innerMax[a]:innerMin[a];
    const topFar=far+sign*(flush?-gap:E-gap);
    const topLength=Math.abs(topFar-entry);
    if(corner<matched-0.05 || corner>Math.min(topWidth,topLength)/2-1 || length-2*radius<8) return fail("radius");
    const B=flush ? E*thickness/(thickness+2*v) : 0;
    const base={color:source.color,rotation:0};
    const round=(name:string,lo:number[],hi:number[],r:number,hole=false)=>sceneShape({...base,id:createLocalId(`${source.id}-rounded-lid`),name,kind:"roundedBox",hole,x:(lo[0]+hi[0])/2,z:(lo[2]+hi[2])/2,elevation:lo[1],width:hi[0]-lo[0],depth:hi[2]-lo[2],height:hi[1]-lo[1],cornerFillet:r,topBottomFillet:0,roundedBoxQuality:24});
    // Each end is described in world coordinates. The loft's stored frame is
    // computed explicitly, so an asymmetric entry does not shift the far end.
    const loft=(name:string,lo:number[],hi:number[],bottomExpansion:number,bottomRadius:number,topRadius:number,hole=false)=>{
      const bottomLo=[...lo],bottomHi=[...hi];
      bottomLo[cross]-=bottomExpansion;bottomHi[cross]+=bottomExpansion;
      if(negative) bottomHi[a]+=bottomExpansion;else bottomLo[a]-=bottomExpansion;
      const bottomCentre=[(bottomLo[0]+bottomHi[0])/2,0,(bottomLo[2]+bottomHi[2])/2];
      const topCentre=[(lo[0]+hi[0])/2,0,(lo[2]+hi[2])/2];
      const fields={...base,id:createLocalId(`${source.id}-rounded-loft`),name,kind:"loft" as const,hole,x:0,z:0,size:1,width:1,depth:1,elevation:lo[1],height:hi[1]-lo[1],loftBottomOutline:"rectangle" as const,loftTopOutline:"rectangle" as const,loftBottomWidth:bottomHi[0]-bottomLo[0],loftBottomDepth:bottomHi[2]-bottomLo[2],loftTopWidth:hi[0]-lo[0],loftTopDepth:hi[2]-lo[2],loftBottomCorner:bottomRadius,loftTopCorner:topRadius,loftOffsetX:topCentre[0]-bottomCentre[0],loftOffsetZ:topCentre[2]-bottomCentre[2],loftWall:0,loftTwist:0,loftSmooth:0,loftSegments:192};
      const frame=loftFrameSize(loftStoredMeasures(fields));
      return sceneShape({...fields,x:bottomCentre[0]+frame.centerX,z:bottomCentre[2]+frame.centerZ,width:frame.width,depth:frame.depth});
    };
    // The opening must stay the same through the whole height occupied by the
    // lid and its supports. Reject tapered, leaning or obstructed upper walls.
    const clearLo=[...innerMin],clearHi=[...innerMax];clearLo[0]+=0.04;clearLo[2]+=0.04;clearHi[0]-=0.04;clearHi[2]-=0.04;clearLo[1]-=0.7;clearHi[1]=bounds.max[1]-0.02;
    const clearanceSolid=shapeToManifoldSolid(runtime,round("Opening check",clearLo,clearHi,Math.max(0,radius-0.04)),made);
    if(!clearanceSolid) return fail("shape");
    const obstruction=clearanceSolid.intersect(body);made.push(obstruction);
    if(obstruction.volume()>0.15) return fail("shape");
    const sweepLo=[...innerMin],sweepHi=[...innerMax];
    const pad=2*radius+2*E+10;
    if(negative) sweepLo[a]=entry-pad;else sweepHi[a]=entry+pad;
    let guide:WorkplaneShape;
    if(flush) guide=loft(t("lid.sliding.channel"),sweepLo,sweepHi,E,radius+E,radius,true);
    else {
      sweepLo[cross]-=E;sweepHi[cross]+=E;
      if(negative) sweepHi[a]+=E;else sweepLo[a]-=E;
      guide=round(t("lid.sliding.channel"),sweepLo,sweepHi,radius+E,true);
    }
    // Check the rounded far end as well as the straight side walls. The swept
    // entry is intentionally outside the box, so exclude only that entry region.
    const up=body.rotate([90,0,0]);made.push(up);
    const section=up.slice((opening.low+Math.min(opening.high,bounds.max[1]))/2);
    const sections: {delete?:()=>void}[]=[section];
    try {
      const polygons=section.toPolygons() as [number,number][][];
      const signed=(p:[number,number][])=>p.reduce((sum,v,i)=>{const next=p[(i+1)%p.length];return sum+v[0]*next[1]-next[0]*v[1];},0)/2;
      const outsidePolygons=polygons.filter(p=>signed(p)>0);
      if(outsidePolygons.length!==1 || roundedRectangleRadius(outsidePolygons[0].map(([x,z])=>[x,-z]))===null) return fail("shape");
      const signature=(p:[number,number][])=>[Math.min(...p.map(v=>v[0])),Math.max(...p.map(v=>v[0])),Math.min(...p.map(v=>v[1])),Math.max(...p.map(v=>v[1])),roundedRectangleRadius(p.map(([x,z])=>[x,-z]))];
      const reference=signature(outsidePolygons[0]);
      for(const height of [opening.low-0.7,bounds.max[1]-0.02]) {
        const sample=up.slice(height);sections.push(sample);
        const outlines=(sample.toPolygons() as [number,number][][]).filter(p=>signed(p)>0);
        if(outlines.length!==1) return fail("shape");
        const values=signature(outlines[0]);
        if(values.some((value,i)=>value===null || reference[i]===null || Math.abs(value!-reference[i]!)>0.08)) return fail("shape");
      }
      const footprint=new runtime.CrossSection(outsidePolygons,"Positive");sections.push(footprint);
      // 0.1 mm allowance is for tessellated arc offsets; nominal wall is 1.2 mm.
      const inset=footprint.offset(-1.1,"Round",2,96);sections.push(inset);
      const prism=inset.extrude(bounds.max[1]-bounds.min[1]);made.push(prism);
      const lifted=prism.translate([0,0,bounds.min[1]]);made.push(lifted);
      const envelope=lifted.rotate([-90,0,0]);made.push(envelope);
      const maskLo=[bounds.min[0]-1,opening.low,bounds.min[2]-1],maskHi=[bounds.max[0]+1,bounds.max[1]-0.02,bounds.max[2]+1];
      if(negative) maskLo[a]=entry+radius+2*E+1;else maskHi[a]=entry-radius-2*E-1;
      if(maskHi[a]<=maskLo[a]) return fail("radius");
      const rawMask=runtime.Manifold.cube([maskHi[0]-maskLo[0],maskHi[1]-maskLo[1],maskHi[2]-maskLo[2]]);made.push(rawMask);
      const mask=rawMask.translate(maskLo as [number,number,number]);made.push(mask);
      const guideSolid=shapeToManifoldSolid(runtime,guide,made);if(!guideSolid) return fail("shape");
      const escaped=guideSolid.subtract(envelope);made.push(escaped);
      const unsafe=escaped.intersect(mask);made.push(unsafe);
      if(unsafe.volume()>0.1) return fail("shape");
    } finally {sections.reverse().forEach(s=>s.delete?.());}
    const cutters=[guide];
    if(!flush) {
      // Open only the entry end above the track. Long straight side guides and
      // the rounded closed end remain intact; a raised thumb grip clears here.
      const lo=[...sweepLo],hi=[...sweepHi];lo[1]=opening.high-0.01;hi[1]=bounds.max[1]+1;
      if(negative) hi[a]=innerMin[a]+radius;else lo[a]=innerMax[a]-radius;
      cutters.push(round(t("lid.sliding.entry"),lo,hi,0,true));
    }
    // Place the matching rounded plate beside the container, top up.
    const topLo=[...innerMin],topHi=[...innerMax];
    topLo[cross]=(innerMin[cross]+innerMax[cross]-topWidth)/2;topHi[cross]=topLo[cross]+topWidth;
    if(negative) {topLo[a]=entry;topHi[a]=topFar;}else {topLo[a]=topFar;topHi[a]=entry;}
    topLo[1]=bounds.min[1];topHi[1]=topLo[1]+thickness;
    const shift=bounds.max[0]+10-topLo[0]+B;
    topLo[0]+=shift;topHi[0]+=shift;
    const plate=flush?loft(t("lid.name",{name:source.name}),topLo,topHi,B,corner+B,corner):round(t("lid.name",{name:source.name}),topLo,topHi,corner);
    const grip=slidingThumbGrip(source,options,topLo,topHi,alongX,negative);
    if(grip && !grip.hole) {
      const lo=[...topLo],hi=[...topHi];hi[1]+=6;
      const column=shapeToManifoldSolid(runtime,round("Grip fit",lo,hi,corner),made),solid=shapeToManifoldSolid(runtime,grip,made);
      if(!column||!solid) return fail("grip");
      const outside=solid.subtract(column);made.push(outside);if(outside.volume()>0.02) return fail("grip");
    }
    // Move paired notches onto the straight side runs, clear of the rounded ends.
    const detentLo=[...topLo],detentHi=[...topHi];detentLo[a]+=corner+B;detentHi[a]-=corner+B;
    const detent=options.clickStop?slidingDetent(source,options,detentLo,detentHi,alongX,negative,shift,opening.low,bounds.min[cross],bounds.max[cross],grip):undefined;
    if(detent && "error" in detent) return detent;
    // Additions use the same placement as the plate. The usual editor grouping
    // keeps guide holes scoped before the wall bumps are added.
    return {plate,grip,lidAdditions:detent?.lidParts,bodyAdditions:detent?.bodyParts,cutters};
  } finally {Array.from(new Set(made)).reverse().forEach(s=>s.delete?.());}
}
