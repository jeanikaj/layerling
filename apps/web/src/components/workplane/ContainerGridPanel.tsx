"use client";
import { useState } from "react";
import { CustomContainerGridLayout } from "./CustomContainerGridLayout";
import { EMPTY_GRID } from "@/lib/containerGridLayout";
import { GuideHelpLink } from "@/components/GuideHelpLink";
import { X, LoaderCircle } from "lucide-react";
import { MovableToolPanel } from "@/components/workplane/MovableToolPanel";
import { EdgeModifierSlider } from "@/components/workplane/EdgeModifierPanel";
import { containerGridLayout, type ContainerGridOptions, type ContainerGridPlan } from "@/lib/containerGrid";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/lib/useLanguage";
import type { WorkplaneWorkspaceSettings } from "@/types/layerling";

export function ContainerGridPanel({targetName,plan,settings,workspace,busy,error,onChange,onApply,onCancel}:{targetName:string;plan:ContainerGridPlan|null;settings:ContainerGridOptions;workspace:WorkplaneWorkspaceSettings;busy:boolean;error:string|null;onChange:(patch:Partial<ContainerGridOptions>)=>void;onApply:()=>void;onCancel:()=>void}) {
  useLanguage();
  const [row, setRow] = useState(0), [column, setColumn] = useState(0);
  const layout=plan?containerGridLayout(plan,settings):null;
  const toggle=(id:string)=>onChange({removed:settings.removed?.includes(id)?settings.removed.filter(v=>v!==id):[...(settings.removed??[]),id]});
  const slider=(label:string,value:number,min:number,max:number,step:number,change:(value:number)=>void,length=false)=><EdgeModifierSlider key={label} label={label} value={value} min={min} max={max} step={step} workspace={workspace} length={length} disabled={busy} onChange={change}/>;
  return <MovableToolPanel className="edge-modifier-panel shell-panel offset-panel" ariaLabel={t("containerGrid.title")}>{handleProps=><>
    <div className="edge-modifier-header movable" title={t("panel.moveHint")} {...handleProps}><div><strong>{t("containerGrid.title")}</strong><span>{targetName}</span></div><GuideHelpLink section="lid"/><button type="button" aria-label={t("containerGrid.cancel")} onClick={onCancel}><X size={20}/></button></div>
    <span className="shell-openings-summary">{t("containerGrid.help")}</span>
    <div className="shell-opening-options" role="radiogroup" aria-label={t("containerGrid.mode")}>
      {(["grid", "custom"] as const).map(mode => <button key={mode} type="button" role="radio" aria-checked={(settings.layout ?? "grid") === mode} className={(settings.layout ?? "grid") === mode ? "active" : ""} disabled={busy} onClick={() => onChange({ layout: mode })}>{t(mode === "grid" ? "containerGrid.mode.grid" : "containerGrid.mode.custom")}</button>)}
    </div>
    {layout?<>
      {settings.layout !== "custom" ? <>
      {slider(t("containerGrid.columns"),layout.columns,1,layout.maxColumns,1,columns=>onChange({columns,positionsX:undefined,removed:[]}))}
      {slider(t("containerGrid.rows"),layout.rows,1,layout.maxRows,1,rows=>onChange({rows,positionsZ:undefined,removed:[]}))}
      </> : null}
      {slider(t("containerGrid.thickness"),layout.thickness,0.8,3,0.1,thickness=>onChange({thickness}),true)}
      {slider(t("containerGrid.height"),layout.height,1,plan!.maxHeight,0.5,height=>onChange({height}),true)}
      <span className="shell-openings-summary">{t("containerGrid.clearance")}</span>
      {settings.layout === "custom" ? <CustomContainerGridLayout root={settings.custom ?? EMPTY_GRID} width={layout.width} depth={layout.depth} thickness={layout.thickness} workspace={workspace} busy={busy} onChange={custom => onChange({ custom })}/> : <>
      <svg viewBox={`-4 -4 ${layout.width+8} ${layout.depth+8}`} style={{width:"100%",height:210,flexShrink:0}} aria-label={t("containerGrid.preview")} role="group">
        <rect width={layout.width} height={layout.depth} rx={Math.min(4,layout.width/5)} fill="none" stroke="currentColor" strokeWidth={0.7}/>
        {layout.segments.map(s=>{
          const x1=s.axis==="x"?s.position:s.from,x2=s.axis==="x"?s.position:s.to,z1=s.axis==="x"?s.from:s.position,z2=s.axis==="x"?s.to:s.position;
          const [, divider, cell] = s.id.split(":");
          return <g key={s.id} role="button" tabIndex={busy?-1:0} aria-disabled={busy} aria-label={t(s.axis==="x"?"containerGrid.columnSegment":"containerGrid.rowSegment",{divider:Number(divider)+1,cell:Number(cell)+1})} aria-pressed={!s.removed} onClick={()=>!busy&&toggle(s.id)} onKeyDown={e=>{if(!busy&&(e.key==="Enter"||e.key===" ")){e.preventDefault();toggle(s.id);}}} style={{cursor:busy?"default":"pointer"}}>
            <line x1={x1} y1={z1} x2={x2} y2={z2} stroke="currentColor" strokeWidth={layout.thickness} opacity={s.removed?0.2:0.9} strokeDasharray={s.removed?"2 2":undefined}/>
            <line x1={x1} y1={z1} x2={x2} y2={z2} stroke="transparent" strokeWidth={Math.max(6,layout.thickness+3)}/>
          </g>;
        })}
      </svg>
      <span className="shell-openings-summary">{t("containerGrid.previewHelp")}</span>
      {(["row", "column"] as const).map(axis => {
        const count = axis === "row" ? layout.rows : layout.columns, chosen = Math.min(axis === "row" ? row : column, count - 1);
        const ids = layout.segments.filter(segment => segment.axis === (axis === "row" ? "x" : "z") && Number(segment.id.split(":")[2]) === chosen).map(segment => segment.id);
        const patch = (clear: boolean) => onChange({ removed: clear ? [...new Set([...(settings.removed ?? []), ...ids])] : (settings.removed ?? []).filter(id => !ids.includes(id)) });
        return <div key={axis}>
          <label className="edge-modifier-field"><span>{t(axis === "row" ? "containerGrid.row" : "containerGrid.column")}</span><select aria-label={t(axis === "row" ? "containerGrid.row" : "containerGrid.column")} value={chosen} disabled={busy} onChange={event => (axis === "row" ? setRow : setColumn)(Number(event.target.value))}>{Array.from({ length: count }, (_, index) => <option key={index} value={index}>{index + 1}</option>)}</select></label>
          <div className="edge-modifier-footer"><button type="button" className="secondary" disabled={busy || !ids.length} onClick={() => patch(true)}>{t(axis === "row" ? "containerGrid.clearRow" : "containerGrid.clearColumn")}</button><button type="button" className="secondary" disabled={busy || !ids.length} onClick={() => patch(false)}>{t("containerGrid.restore")}</button></div>
        </div>;
      })}
      <button type="button" className="secondary" disabled={busy} onClick={()=>onChange({positionsX:undefined,positionsZ:undefined,removed:[]})}>{t("containerGrid.reset")}</button>
      {(["x","z"] as const).map(axis=>{
        const positions=axis==="x"?layout.xs:layout.zs;
        return positions.map((value,index)=>{
          const limits=layout.limits(axis,index);if(!limits)return null;
          return slider(t(axis==="x"?"containerGrid.positionX":"containerGrid.positionZ",{number:index+1}),value,limits.min,limits.max,0.1,next=>{const changed=[...positions];changed[index]=next;onChange(axis==="x"?{positionsX:changed}:{positionsZ:changed});},true);
        });
      })}
      </>}
    </>:busy?<span role="status"><LoaderCircle size={16} className="edge-modifier-spinner"/>{t("containerGrid.working")}</span>:null}
    {error?<div className="edge-modifier-error" role="alert">{error}</div>:null}
    <div className="edge-modifier-footer"><button type="button" className="secondary" onClick={onCancel}>{t("common.cancel")}</button><button type="button" disabled={busy||!layout||(settings.layout === "custom" && !layout.custom.valid)} onClick={onApply}>{busy?<LoaderCircle size={16} className="edge-modifier-spinner"/>:null}{t("containerGrid.apply")}</button></div>
  </>}</MovableToolPanel>;
}
