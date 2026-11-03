"use client";
import { useRef, useState } from "react";
import { EdgeModifierSlider } from "@/components/workplane/EdgeModifierPanel";
import { changeGridNode, customGridLayout, EMPTY_GRID, normalizeGridTree } from "@/lib/containerGridLayout";
import { createLocalId } from "@/lib/localIds";
import { numberLocale, t } from "@/lib/i18n";
import type { ContainerGridNode, WorkplaneWorkspaceSettings } from "@/types/layerling";

export function CustomContainerGridLayout({ root, width, depth, thickness, workspace, busy, onChange }: { root: ContainerGridNode; width: number; depth: number; thickness: number; workspace: WorkplaneWorkspaceSettings; busy: boolean; onChange: (root: ContainerGridNode) => void }) {
  const tree = normalizeGridTree(root), layout = customGridLayout(tree, width, depth, thickness);
  const [selected, setSelected] = useState(tree.id);
  const svg = useRef<SVGSVGElement>(null), drag = useRef<string | null>(null);
  const cell = layout.cells.find(cell => cell.id === selected) ?? layout.cells[0];
  const division = layout.divisions.find(division => division.id === selected) ?? layout.divisions.find(division => division.id === cell?.parentId);
  const measure = (value: number) => value.toLocaleString(numberLocale(), { maximumFractionDigits: 1 });
  const resize = (id: string, firstSize: number) => {
    const division = layout.divisions.find(division => division.id === id);
    if (!division || busy) return;
    const available = (division.axis === "x" ? division.xmax - division.xmin : division.zmax - division.zmin) - thickness;
    const ratio = Math.max(division.min, Math.min(division.max, firstSize)) / available;
    onChange(changeGridNode(tree, id, node => node.split ? { ...node, split: { ...node.split, ratio } } : node));
  };
  const split = (axis: "x" | "z") => {
    if (!cell || busy || layout.cells.length >= 40) return;
    const first = createLocalId("compartment"), second = createLocalId("compartment");
    onChange(changeGridNode(tree, cell.id, node => ({ ...node, split: { axis, ratio: 0.5, first: { id: first }, second: { id: second } } })));
    setSelected(first);
  };
  const merge = () => {
    if (!division || busy) return;
    onChange(changeGridNode(tree, division.id, node => ({ id: node.id })));
    setSelected(division.id);
  };
  return <>
    <span className="shell-openings-summary">{t("containerGrid.customHelp")}</span>
    {!layout.valid ? <div className="edge-modifier-error" role="alert">{t("containerGrid.error.layout")}</div> : null}
    <svg ref={svg} viewBox={`-4 -4 ${width + 8} ${depth + 8}`} style={{ width: "100%", height: 250, flexShrink: 0, touchAction: "none" }} aria-label={t("containerGrid.customPreview")} role="group"
      onPointerMove={event => {
        const division = layout.divisions.find(division => division.id === drag.current), matrix = svg.current?.getScreenCTM();
        if (!division || !matrix || busy) return;
        const point = svg.current!.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
        const local = point.matrixTransform(matrix.inverse());
        resize(division.id, (division.axis === "x" ? local.x - division.xmin : local.y - division.zmin) - thickness / 2);
      }}
      onPointerUp={event => { drag.current = null; if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; }}>
      <rect width={width} height={depth} fill="none" stroke="currentColor" strokeWidth={0.7}/>
      {layout.cells.map((region, index) => {
        const w = region.xmax - region.xmin, d = region.zmax - region.zmin, size = Math.max(2, Math.min(6, Math.min(w, d) / 5));
        return <g key={region.id} role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy} aria-pressed={cell?.id === region.id && !layout.divisions.some(division => division.id === selected)} aria-label={t("containerGrid.cell", { number: index + 1, width: measure(w), depth: measure(d) })}
          onClick={() => { if (!busy) setSelected(region.id); }} onKeyDown={event => { if (!busy && ["Enter", " "].includes(event.key)) { event.preventDefault(); setSelected(region.id); } }} style={{ cursor: "pointer" }}>
          <rect x={region.xmin} y={region.zmin} width={w} height={d} fill="currentColor" opacity={cell?.id === region.id ? 0.15 : 0.035}/>
          <text x={(region.xmin + region.xmax) / 2} y={(region.zmin + region.zmax) / 2} textAnchor="middle" dominantBaseline="middle" fontSize={size} fill="currentColor" pointerEvents="none">{measure(w)} × {measure(d)}</text>
        </g>;
      })}
      {layout.divisions.map((line, index) => {
        const x = line.axis === "x", chosen = selected === line.id;
        return <g key={line.id} role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy} aria-pressed={chosen} aria-label={t(x ? "containerGrid.verticalDivision" : "containerGrid.horizontalDivision", { number: index + 1 })} style={{ cursor: busy ? "default" : x ? "ew-resize" : "ns-resize" }}
          onClick={() => { if (!busy) setSelected(line.id); }}
          onPointerDown={event => { if (busy) return; event.preventDefault(); setSelected(line.id); drag.current = line.id; svg.current?.setPointerCapture(event.pointerId); }}
          onKeyDown={event => {
            if (busy) return;
            if (["Enter", " "].includes(event.key)) { event.preventDefault(); setSelected(line.id); }
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); setSelected(line.id); resize(line.id, line.firstSize + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) * (event.shiftKey ? 1 : 0.1)); }
          }}>
          <line x1={x ? line.position : line.from} y1={x ? line.from : line.position} x2={x ? line.position : line.to} y2={x ? line.to : line.position} stroke="currentColor" strokeWidth={thickness} opacity={chosen ? 1 : 0.65}/>
          <line x1={x ? line.position : line.from} y1={x ? line.from : line.position} x2={x ? line.position : line.to} y2={x ? line.to : line.position} stroke="transparent" strokeWidth={Math.max(6, thickness + 3)}/>
        </g>;
      })}
    </svg>
    {cell ? <div className="edge-modifier-footer">
      <button type="button" disabled={busy || layout.cells.length >= 40 || cell.xmax - cell.xmin < 12 + thickness} onClick={() => split("x")}>{t("containerGrid.splitColumns")}</button>
      <button type="button" disabled={busy || layout.cells.length >= 40 || cell.zmax - cell.zmin < 12 + thickness} onClick={() => split("z")}>{t("containerGrid.splitRows")}</button>
    </div> : null}
    {division ? <>
      <EdgeModifierSlider label={t(division.axis === "x" ? "containerGrid.firstWidth" : "containerGrid.firstDepth")} value={division.firstSize} min={division.min} max={division.max} step={0.1} workspace={workspace} length disabled={busy} onChange={size => resize(division.id, size)}/>
      <button type="button" className="secondary" disabled={busy} onClick={merge}>{t("containerGrid.merge")}</button>
      <span className="shell-openings-summary">{t("containerGrid.mergeHelp")}</span>
    </> : null}
    <button type="button" className="secondary" disabled={busy} onClick={() => { onChange(EMPTY_GRID); setSelected(EMPTY_GRID.id); }}>{t("containerGrid.clearAll")}</button>
  </>;
}
