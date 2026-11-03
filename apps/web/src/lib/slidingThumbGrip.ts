import type { LidOptions } from "@/lib/lidTool";
import type { WorkplaneShape } from "@/types/layerling";
import { sceneShape } from "@/lib/shapeCatalog";
import { createLocalId } from "@/lib/localIds";
import { t } from "@/lib/i18n";

/** A native CAD shape, safely inside the central plate and away from the guide rails.
 * Edge recesses straddle the opening edge; raised grips terminate at that edge.
 * Recess depth always leaves a floor, including on the thinnest allowed lids.
 */
export function slidingThumbGrip(source: WorkplaneShape, options: LidOptions, min: number[], max: number[], alongX: boolean, negative: boolean): WorkplaneShape | undefined {
  if (options.thumbGrip === false) return undefined;
  const a = alongX ? 0 : 2;
  const cross = alongX ? 2 : 0;
  const availableWidth = max[cross] - min[cross] - 2;
  const availableLength = max[a] - min[a] - 2;
  if (availableWidth < 1 || availableLength < 1) return undefined;
  const shape = options.gripShape ?? "circle";
  const raised = options.gripMode === "raised";
  const defaultSize = Math.min(12, availableWidth, (max[a] - min[a]) / 3);
  const requestedWidth = options.gripWidth ?? (shape === "slot" ? 20 : defaultSize);
  let width = Math.min(requestedWidth, availableWidth);
  let length = Math.min(options.gripLength ?? (shape === "slot" ? 5 : defaultSize), availableLength);
  if (shape === "circle") width = length = Math.min(width, availableLength);
  const centre = [(min[0]+max[0])/2, 0, (min[2]+max[2])/2];
  const atEdge = options.gripPosition === "edge";
  const inset = Math.min(options.gripInset ?? 1, Math.max(0, availableLength-length));
  const distance = atEdge && !raised ? 0 : length/2 + (atEdge ? 0 : inset);
  centre[a] = negative ? min[a]+distance : max[a]-distance;
  const thickness = max[1]-min[1];
  const depth = raised ? (options.gripDepth ?? 0.6) : Math.min(options.gripDepth ?? 0.6, thickness-Math.min(0.4,2*thickness/3));
  const rounded = shape === "roundedRectangle" || shape === "slot";
  const radius = shape === "slot" ? Math.min(width,length)/2 : Math.min(options.gripCornerRadius ?? 2, Math.min(width,length)/2);
  return sceneShape({
    id:createLocalId(`${source.id}-thumb-grip`),name:t("lid.sliding.grip"),color:source.color,
    kind:rounded ? "roundedBox" : "cylinder",hole:!raised,
    x:centre[0],z:centre[2],elevation:raised ? max[1]-0.02 : max[1]-depth,
    width:alongX ? length : width,depth:alongX ? width : length,
    height:raised ? depth+0.02 : depth+1,rotation:0,sides:64,
    ...(rounded ? {cornerFillet:radius,topBottomFillet:0,roundedBoxQuality:8} : {}),
  });
}
