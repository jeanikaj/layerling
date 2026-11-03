// @vitest-environment jsdom
import {act,createElement,useState} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,describe,it,expect} from "vitest";
import {ContainerGridPanel} from "@/components/workplane/ContainerGridPanel";
import {CONTAINER_GRID_DEFAULTS,type ContainerGridOptions,type ContainerGridPlan} from "@/lib/containerGrid";
import {DEFAULT_WORKPLANE_WORKSPACE} from "@/lib/workplaneSettings";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement;
afterEach(()=>{act(()=>root?.unmount());host?.remove();});
const plan:ContainerGridPlan={xmin:0,xmax:102,zmin:0,zmax:182,outerXmin:-4,outerXmax:106,outerZmin:-4,outerZmax:186,outerRadius:20,bottom:0,floor:2,top:50,maxHeight:43};
function mount(options:Partial<ContainerGridOptions>={},busy=false){const changes:Partial<ContainerGridOptions>[]=[];host=document.createElement("div");document.body.append(host);root=createRoot(host);act(()=>root.render(createElement(ContainerGridPanel,{targetName:"Box",plan,settings:{...CONTAINER_GRID_DEFAULTS,...options},workspace:DEFAULT_WORKPLANE_WORKSPACE,busy,error:null,onChange:p=>changes.push(p),onApply:()=>{},onCancel:()=>{}})));return changes;}
describe("container grid panel",()=>{
 it("offers size controls and individually toggles divider sections by mouse and keyboard",()=>{
  const changes=mount();
  for(const label of ["Columns across","Rows deep","Divider thickness","Height above floor"])expect(host.textContent).toContain(label);
  const segment=host.querySelector<SVGGElement>('[aria-label="Column divider 1, row 1"]')!;
  expect(segment.getAttribute("aria-pressed")).toBe("true");act(()=>segment.dispatchEvent(new MouseEvent("click",{bubbles:true})));expect(changes.at(-1)).toEqual({removed:["x:0:0"]});
  act(()=>segment.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));expect(changes.at(-1)).toEqual({removed:["x:0:0"]});
  const reset=[...host.querySelectorAll("button")].find(b=>b.textContent==="Reset to equal compartments")!;act(()=>reset.click());expect(changes.at(-1)).toEqual({positionsX:undefined,positionsZ:undefined,removed:[]});
 });
 it("allows clearing all dividers and prevents layout changes while busy",()=>{
  mount({rows:1,columns:1});expect([...host.querySelectorAll("button")].find(b=>b.textContent?.includes("Add grid"))!.disabled).toBe(false);
  act(()=>root.unmount());const changes=mount({},true);const segment=host.querySelector('[aria-label="Column divider 1, row 1"]')!;act(()=>segment.dispatchEvent(new MouseEvent("click",{bubbles:true})));expect(changes).toHaveLength(0);
 });
});

it("splits only the chosen compartment, resizes by keyboard, and merges a branch",()=>{
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
 function Harness(){const [settings,setSettings]=useState({...CONTAINER_GRID_DEFAULTS,layout:"custom" as const});return createElement(ContainerGridPanel,{targetName:"Box",plan,settings,workspace:DEFAULT_WORKPLANE_WORKSPACE,busy:false,error:null,onChange:p=>setSettings(s=>({...s,...p})),onApply:()=>{},onCancel:()=>{}});}
 act(()=>root.render(createElement(Harness)));
 const button=(text:string)=>[...host.querySelectorAll("button")].find(b=>b.textContent===text)!;
 act(()=>button("Split into columns").click());
 act(()=>button("Split into rows").click());
 expect(host.querySelectorAll('[aria-label^="Compartment "]')).toHaveLength(3);
 const divider=host.querySelector('[aria-label="Horizontal divider 2"]')!;
 const before=host.textContent;
 act(()=>divider.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",shiftKey:true,bubbles:true})));
 expect(host.textContent).not.toBe(before);
 act(()=>button("Clear selected division").click());
 expect(host.querySelectorAll('[aria-label^="Compartment "]')).toHaveLength(2);
 act(()=>button("Clear all divisions").click());
 expect(host.querySelectorAll('[aria-label^="Compartment "]')).toHaveLength(1);
});
it("clears a regular row while preserving horizontal borders",()=>{
 const changes=mount();const button=[...host.querySelectorAll("button")].find(b=>b.textContent==="Clear row dividers")!;
 act(()=>button.click());expect(changes.at(-1)).toEqual({removed:["x:0:0"]});
});
