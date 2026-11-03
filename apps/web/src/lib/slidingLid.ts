import type { ManifoldToplevel } from "manifold-3d";
import type { ManifoldSolid } from "@/lib/editorMeshCore";
import { sceneShape } from "@/lib/shapeCatalog";
import { createLocalId } from "@/lib/localIds";
import { t } from "@/lib/i18n";
import { slidingThumbGrip } from "@/lib/slidingThumbGrip";
import type { LidOptions } from "@/lib/lidTool";
import type { WorkplaneShape } from "@/types/layerling";

/** Shared dimensions for the plate and its cutters, in world coordinates (scene y is up).
 * Deliberately conservative: a rectangular, constant cavity at the guide height. Rounded
 * outer corners are supported only where the channels retain their outside skin.
 * Native box/cylinder parts preserve the existing CAD reconstruction and STEP path.
 */
export function slidingLidParts(runtime: ManifoldToplevel, body: ManifoldSolid, source: WorkplaneShape, options: LidOptions):
  { plate: WorkplaneShape; rails?: WorkplaneShape[]; grip?: WorkplaneShape; cutters: WorkplaneShape[] } | { error: string } {
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
    const flush = options.slidingStyle === "flush";
    const roof = options.guideRoof ?? 1.2;
    const high = flush ? bounds.max[1] + verticalGap : bounds.max[1] - roof;
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
      if (flush) hi[1] = bounds.max[1];
      const skin=cube(lo,hi);
      if (keep(skin.subtract(body)).volume() > 0.02) return fail("thin");
    }
    // Each guide needs a roof and a supporting ledge; a sampled ring alone is
    // insufficient for a box with an upper notch or a tapered wall.
    for (const positive of [false,true]) {
      for (const above of (flush ? [false] : [false,true])) {
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
    // Wedges widen the channel below the rim, retaining a flush plate against lifting.
    // Their height includes clearance above and below the plate, so their slope is
    // shared with the plate rails, with clearance at every point on the bevel.
    const wedge = (lo: number[], hi: number[], positive: boolean, hole: boolean) => {
      const width=hi[cross]-lo[cross], length=hi[a]-lo[a];
      return sceneShape({ id:createLocalId(`${source.id}-sliding-bevel`), name:t("lid.sliding.bevel"), kind:"wedge",color:source.color,hole,
        x:(lo[0]+hi[0])/2,z:(lo[2]+hi[2])/2,elevation:lo[1],
        width,depth:length,height:hi[1]-lo[1], rotation:(alongX ? 90 : 0)+((alongX ? !positive : positive) ? 180 : 0) });
    };
    const guideCutters: WorkplaneShape[] = [];
    if (flush) {
      const lo=[...min],hi=[...max];
      lo[cross]+=engagement;hi[cross]-=engagement;
      guideCutters.push(makeBox(t("lid.sliding.channel"),lo,hi,true));
      for (const positive of [false,true]) {
        const edgeMin=[...min],edgeMax=[...max];
        if (positive) edgeMin[cross]=hi[cross]; else edgeMax[cross]=lo[cross];
        guideCutters.push(wedge(edgeMin,edgeMax,positive,true));
      }
    } else guideCutters.push(channel);
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
    const railWidth=engagement * options.thickness / (options.thickness+2*verticalGap);
    if (flush && railWidth <= options.gap+0.1) return fail("thin");
    // Flush: the central plate reaches the rim, with matching sloping rails below it.
    if (flush) {
      lidMin[cross]+=engagement;
      lidMax[cross]-=engagement;
    }
    // Plate lies beside the box, top facing up so artwork is easy to place.
    const shift=bounds.max[0]+10-lidMin[0]+(flush && cross === 0 ? railWidth : 0);
    lidMin[0]+=shift; lidMax[0]+=shift;
    lidMin[1]=bounds.min[1]; lidMax[1]=lidMin[1]+options.thickness;
    const plate=makeBox(t("lid.name", { name:source.name }), lidMin,lidMax);
    const rails: WorkplaneShape[] = [];
    if (flush) {
      for (const positive of [false,true]) {
        const lo=[...lidMin],hi=[...lidMax];
        // Small overlap makes a reliable union without changing the shared slope.
        if (positive) { lo[cross]=lidMax[cross]-0.01;hi[cross]=lidMax[cross]+railWidth; }
        else { lo[cross]=lidMin[cross]-railWidth;hi[cross]=lidMin[cross]+0.01; }
        rails.push(wedge(lo,hi,positive,false));
      }
    }
    const grip = slidingThumbGrip(source, options, lidMin, lidMax, alongX, negative);
    return { plate, rails, grip, cutters:[...guideCutters,entry] };
  } finally { Array.from(new Set(made)).reverse().forEach(v=>v.delete?.()); }
}
