import type { ContainerGridNode } from "@/types/layerling";
export type GridRegion = { xmin: number; xmax: number; zmin: number; zmax: number };
export type GridCell = GridRegion & { id: string; parentId?: string };
export type GridDivision = GridRegion & { id: string; axis: "x" | "z"; position: number; from: number; to: number; firstSize: number; min: number; max: number };
export const EMPTY_GRID: ContainerGridNode = { id: "root" };
const MIN_CELL = 6;

/** A bounded tree of rectangular compartments; split ratios survive resizing of their parent. */
export function normalizeGridTree(value: unknown): ContainerGridNode {
  let remaining = 39;
  const ids = new Set<string>();
  const read = (value: unknown, path: string, depth: number): ContainerGridNode => {
    const node = value && typeof value === "object" ? value as Partial<ContainerGridNode> : {};
    let id = typeof node.id === "string" && node.id.length < 80 && !ids.has(node.id) ? node.id : `cell-${path}`;
    while (ids.has(id)) id += "-";
    ids.add(id);
    const split = node.split;
    if (!split || depth >= 12 || remaining <= 0 || !["x", "z"].includes(split.axis)) return { id };
    remaining--;
    return { id, split: { axis: split.axis, ratio: Number.isFinite(split.ratio) ? Math.max(0, Math.min(1, split.ratio)) : 0.5, first: read(split.first, `${path}-a`, depth + 1), second: read(split.second, `${path}-b`, depth + 1) } };
  };
  return read(value, "root", 0);
}
export function changeGridNode(root: ContainerGridNode, id: string, update: (node: ContainerGridNode) => ContainerGridNode): ContainerGridNode {
  if (root.id === id) return update(root);
  if (!root.split) return root;
  return { ...root, split: { ...root.split, first: changeGridNode(root.split.first, id, update), second: changeGridNode(root.split.second, id, update) } };
}
export function gridNodeMinimum(node: ContainerGridNode, thickness: number): { width: number; depth: number } {
  if (!node.split) return { width: MIN_CELL, depth: MIN_CELL };
  const a = gridNodeMinimum(node.split.first, thickness), b = gridNodeMinimum(node.split.second, thickness);
  return node.split.axis === "x" ? { width: a.width + thickness + b.width, depth: Math.max(a.depth, b.depth) } : { width: Math.max(a.width, b.width), depth: a.depth + thickness + b.depth };
}

/** Shared by the plan view and geometry: all T-junctions meet the parent divider without gaps. */
export function customGridLayout(root: ContainerGridNode, width: number, depth: number, thickness: number) {
  const cells: GridCell[] = [], divisions: GridDivision[] = [];
  const minimum = gridNodeMinimum(root, thickness);
  const valid = minimum.width <= width + 1e-6 && minimum.depth <= depth + 1e-6;
  const visit = (node: ContainerGridNode, region: GridRegion, parentId?: string) => {
    const split = node.split;
    if (!split) { cells.push({ ...region, id: node.id, parentId }); return; }
    const x = split.axis === "x", start = x ? region.xmin : region.zmin, end = x ? region.xmax : region.zmax;
    const a = gridNodeMinimum(split.first, thickness), b = gridNodeMinimum(split.second, thickness);
    const min = x ? a.width : a.depth, max = end - start - thickness - (x ? b.width : b.depth);
    const firstSize = Math.max(min, Math.min(max, (end - start - thickness) * split.ratio));
    const position = start + firstSize + thickness / 2;
    divisions.push({ ...region, id: node.id, axis: split.axis, position, from: x ? region.zmin : region.xmin, to: x ? region.zmax : region.xmax, firstSize, min, max });
    visit(split.first, x ? { ...region, xmax: position - thickness / 2 } : { ...region, zmax: position - thickness / 2 }, node.id);
    visit(split.second, x ? { ...region, xmin: position + thickness / 2 } : { ...region, zmin: position + thickness / 2 }, node.id);
  };
  if (valid) visit(root, { xmin: 0, xmax: width, zmin: 0, zmax: depth });
  return { cells, divisions, valid };
}
