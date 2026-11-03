import type { LidOptions } from "@/lib/lidTool";
import type { WorkplaneShape } from "@/types/layerling";
import { sceneShape } from "@/lib/shapeCatalog";
import { createLocalId } from "@/lib/localIds";
import { t } from "@/lib/i18n";

/** Two blind side notches near the closed end, receiving rounded bumps on the
 * box. Underside reliefs leave a continuous top skin. Elastic retention and
 * release force require print testing; geometry checks do not simulate flexure.
 */
export function slidingDetent(source: WorkplaneShape, options: LidOptions, min: number[], max: number[], alongX: boolean, negative: boolean, shiftX: number, channelLow: number, outsideMin: number, outsideMax: number, grip?: WorkplaneShape):
 {lidParts:WorkplaneShape[];bodyParts:WorkplaneShape[]} | {error:string} {
  const a=alongX?0:2,cross=alongX?2:0;
  const fail=()=>({error:t("lid.click.error")});
  const thickness=max[1]-min[1],length=max[a]-min[a];
  if(thickness<1.2 || length<22 || max[cross]-min[cross]<10) return fail();
  const closedSign=negative?1:-1,end=negative?max[a]:min[a];
  const gap=options.verticalGap??0.2,engagement=options.engagement??0.8;
  const radius=0.65,clearance=0.15,skin=Math.min(0.6,thickness*0.4);
  const bumpHeight=Math.min(0.4,thickness*0.3),bottom=0.2*thickness;
  const interference=options.clickInterference??0.2;
  const slope=options.slidingStyle==="flush" ? engagement/(thickness+2*gap) : 0;
  if(interference+slope*bumpHeight>0.45) return fail();
  const lidParts:WorkplaneShape[]=[],bodyParts:WorkplaneShape[]=[];
  for(const positive of [false,true]) {
    const sign=positive?1:-1,edge=positive?max[cross]:min[cross];
    const slotLo=[...min],slotHi=[...max];
    slotLo[a]=Math.min(end+closedSign,end-closedSign*12);
    slotHi[a]=Math.max(end+closedSign,end-closedSign*12);
    slotLo[cross]=positive?edge-1.8:edge+1.2;
    slotHi[cross]=positive?edge-1.2:edge+1.8;
    slotLo[1]-=1;slotHi[1]-=skin;
    if(grip) {
      const gmin=[grip.x-(grip.width??grip.size!)/2,grip.elevation??0,grip.z-(grip.depth??grip.size!)/2];
      const gmax=[grip.x+(grip.width??grip.size!)/2,(grip.elevation??0)+grip.height,grip.z+(grip.depth??grip.size!)/2];
      if([0,1,2].every(i=>gmin[i]<slotHi[i]+0.5 && gmax[i]>slotLo[i]-0.5)) return fail();
    }
    // Width of the lid at the top of the small bump's vertical band.
    const rail=options.slidingStyle==="flush" ? engagement*thickness/(thickness+2*gap)-(engagement*thickness/(thickness+2*gap)+0.01)*(bottom+bumpHeight)/thickness : 0;
    const centre=[(min[0]+max[0])/2,min[1]+bottom,(min[2]+max[2])/2];
    centre[a]=end-closedSign*2;
    centre[cross]=edge+sign*(rail+radius-interference);
    const bump=sceneShape({id:createLocalId(`${source.id}-click-bump`),name:t("lid.click.bump"),kind:"cylinder",color:source.color,x:centre[0]-shiftX,z:centre[2],elevation:channelLow+gap+bottom,width:2*radius,depth:2*radius,height:bumpHeight,sides:64,rotation:0});
    // Printed part is entirely within the original outside wall; no outside bulge.
    const bumpCross=cross===0?bump.x:bump.z;
    if(bumpCross-radius<outsideMin-1e-6 || bumpCross+radius>outsideMax+1e-6) return fail();
    const notch=sceneShape({...bump,id:createLocalId(`${source.id}-click-notch`),name:t("lid.click.pocket"),hole:true,x:centre[0],z:centre[2],elevation:min[1]+bottom-clearance,width:2*(radius+clearance),depth:2*(radius+clearance),height:bumpHeight+2*clearance});
    const slot=sceneShape({id:createLocalId(`${source.id}-click-relief`),name:t("lid.click.slot"),kind:"box",color:source.color,hole:true,x:(slotLo[0]+slotHi[0])/2,z:(slotLo[2]+slotHi[2])/2,elevation:slotLo[1],width:slotHi[0]-slotLo[0],depth:slotHi[2]-slotLo[2],height:slotHi[1]-slotLo[1],rotation:0});
    lidParts.push(notch,slot);bodyParts.push(bump);
  }
  return {lidParts,bodyParts};
}
