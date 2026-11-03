import type { ManifoldToplevel } from "manifold-3d";
import type { ManifoldSolid } from "@/lib/editorMeshCore";
import { sceneShape } from "@/lib/shapeCatalog";
import { createLocalId } from "@/lib/localIds";
import { t } from "@/lib/i18n";
import type { LidOptions } from "@/lib/lidTool";
import type { WorkplaneShape } from "@/types/layerling";

/** Shared dimensions for the plate and its cutters, in world coordinates (scene y is up).
 * Deliberately conservative: a rectangular, constant cavity at the guide height. Rounded
 * outer corners are supported only where the channels retain their outside skin.
 * Native box/cylinder parts preserve the existing CAD reconstruction and STEP path.
 */
export function slidingLidParts(runtime: ManifoldToplevel, body: ManifoldSolid, source: WorkplaneShape, options: LidOptions):
  { plate: WorkplaneShape; grip?: WorkplaneShape; cutters: WorkplaneShape[] } | { error: string } {
  const made: { delete?: () => void }[] = [];
  const keep = <T extends { delete?: () => void }>(v: T): T => { made.push(v); return v; };
  const fail = (key: "unsupported" | "thin" | "blocked" | "shallow") => ({ error: t(`lid.sliding.error.${key}`) });
  try {
    const bounds = body.boundingBox();
    const side = options.openingSide ?? "front";
    const alongX = side === "left" || side === "right";
    const negative = side === "front" || side === "left";
    const verticalGap = options.verticalGap ?? 0.2;
    const engagement = options.engagement ?? 0.8;
    const roof = options.guideRoof ?? 1.2;
    const high = bounds.max[1] - roof;
    const low = high - options.thickness - 2 * verticalGap;
    if (low < bounds.min[1] + 1.2) return fail("shallow");
    const up = keep(body.rotate([90, 0, 0]));
    const section = keep(up.slice((low + high) / 2));
    const polygons = section.toPolygons() as [number, number][][];
    const area = (p: [number, number][]) => p.reduce((s, [x,y], i) => { const n=p[(i+1)%p.length]; return s+x*n[1]-n[0]*y; }, 0)/2;
    const outers = polygons.filter(p => area(p) > 0);
    const holes = polygons.filter(p => area(p) < 0);
    if (outers.length !== 1 || holes.length !== 1) return fail("unsupported");
    const hole = holes[0];
    const xmin = Math.min(...hole.map(p=>p[0])), xmax = Math.max(...hole.map(p=>p[0]));
    const zmin = -Math.max(...hole.map(p=>p[1])), zmax = -Math.min(...hole.map(p=>p[1]));
    // Rounded cavities, irregular walls and dividers must not be mistaken for a clear rectangle.
    if (Math.abs(Math.abs(area(hole)) - (xmax-xmin)*(zmax-zmin)) > 0.05) return fail("unsupported");
    const a = alongX ? 0 : 2, cross = alongX ? 2 : 0;
    const min = [xmin, low, zmin], max = [xmax, high, zmax];
    const cavityMin = [...min], cavityMax = [...max];
    cavityMin[0] += 0.02; cavityMin[2] += 0.02;
    cavityMax[0] -= 0.02; cavityMax[2] -= 0.02;
    if (cavityMax[0] <= cavityMin[0] || cavityMax[2] <= cavityMin[2]) return fail("unsupported");
    const cube = (lo: number[], hi: number[]) => keep(keep(runtime.Manifold.cube([hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]])).translate(lo as [number,number,number]));
    // Check the whole height of the travel space, not only the sampled section.
    if (keep(body.intersect(cube(cavityMin,cavityMax))).volume() > 0.02) return fail("blocked");
    min[cross] -= engagement; max[cross] += engagement;
    const outside = [bounds.min[0], bounds.min[1], bounds.min[2]];
    const outsideMax = [bounds.max[0], bounds.max[1], bounds.max[2]];
    if (min[cross] - outside[cross] < 1.2 - 1e-6 || outsideMax[cross] - max[cross] < 1.2 - 1e-6) return fail("thin");
    // Require real wall material outside both guide channels through the entire run.
    for (const positive of [false,true]) {
      const lo=[...min], hi=[...max];
      lo[cross] = positive ? max[cross] : min[cross]-1.2;
      hi[cross] = positive ? max[cross]+1.2 : min[cross];
      const skin=cube(lo,hi);
      if (keep(skin.subtract(body)).volume() > 0.02) return fail("thin");
    }
    // Each guide needs a roof and a supporting ledge; a sampled ring alone is
    // insufficient for a box with an upper notch or a tapered wall.
    for (const positive of [false,true]) {
      for (const above of [false,true]) {
        const lo=[...min],hi=[...max];
        lo[cross]=positive ? (alongX ? zmax : xmax) : min[cross];
        hi[cross]=positive ? max[cross] : (alongX ? zmin : xmin);
        lo[1]=above ? high : low-0.8;
        hi[1]=above ? bounds.max[1] : low;
        if (keep(cube(lo,hi).subtract(body)).volume() > 0.02) return fail("thin");
      }
    }
    const makeBox = (name: string, lo: number[], hi: number[], hole = false) => sceneShape({
      id: createLocalId(`${source.id}-sliding`), name, kind: "box", color: source.color, hole,
      x:(lo[0]+hi[0])/2, z:(lo[2]+hi[2])/2, elevation:lo[1],
      width:hi[0]-lo[0], height:hi[1]-lo[1], depth:hi[2]-lo[2], rotation:0,
    });
    const channel = makeBox(t("lid.sliding.channel"), min, max, true);
    const entryMin=[...min], entryMax=[...max];
    entryMax[1]=bounds.max[1]+1;
    if (negative) { entryMin[a]=outside[a]-1; entryMax[a]=min[a]+0.05; }
    else { entryMin[a]=max[a]-0.05; entryMax[a]=outsideMax[a]+1; }
    const entry = makeBox(t("lid.sliding.entry"), entryMin, entryMax, true);
    const lidMin=[...min], lidMax=[...max];
    lidMin[cross]+=options.gap; lidMax[cross]-=options.gap;
    lidMin[a]+=options.gap; lidMax[a]-=options.gap;
    if (negative) lidMin[a]=outside[a]; else lidMax[a]=outsideMax[a];
    if (lidMax[cross]-lidMin[cross] < 4 || lidMax[a]-lidMin[a] < 8 || engagement <= options.gap+0.1) return fail("thin");
    // Plate lies beside the box, top facing up so artwork is easy to place.
    const shift=bounds.max[0]+10-lidMin[0];
    lidMin[0]+=shift; lidMax[0]+=shift;
    lidMin[1]=bounds.min[1]; lidMax[1]=lidMin[1]+options.thickness;
    const plate=makeBox(t("lid.name", { name:source.name }), lidMin,lidMax);
    let grip: WorkplaneShape | undefined;
    if (options.thumbGrip !== false) {
      const length=lidMax[a]-lidMin[a], width=lidMax[cross]-lidMin[cross];
      const diameter=Math.min(12,width-2,length/3);
      if (diameter >= 3) {
        const centre=[(lidMin[0]+lidMax[0])/2,0,(lidMin[2]+lidMax[2])/2];
        centre[a]=negative ? lidMin[a]+diameter/2+1 : lidMax[a]-diameter/2-1;
        const depth=Math.min(0.6,options.thickness/3);
        grip=sceneShape({ id:createLocalId(`${source.id}-thumb-grip`), name:t("lid.sliding.grip"), kind:"cylinder", hole:true, color:source.color,
          x:centre[0],z:centre[2],elevation:lidMax[1]-depth,width:diameter,depth:diameter,height:depth+1,sides:48,rotation:0 });
      }
    }
    return { plate, grip, cutters:[channel,entry] };
  } finally { Array.from(new Set(made)).reverse().forEach(v=>v.delete?.()); }
}
