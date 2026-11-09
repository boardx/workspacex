import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BoardMinimapScene } from "@/components/whiteboard/board-minimap-scene";
import { BoardMinimap } from "@/components/whiteboard/board-minimap";
import { BoardViewportControls } from "@/components/whiteboard/board-viewport-controls";
import { minimapGeometry, minimapPan } from "@/components/whiteboard/board-minimap-geometry";
import type { MinimapObject } from "@/components/whiteboard/board-minimap-geometry";
const viewport = { zoom: .5, panX: 400, panY: 100, fitRequest: 0 };
const frame = { width: 1000, height: 600 };
const object = { id: "negative", kind: "sticky", geometry: { x: -2400, y: -900, width: 200, height: 200, rotation: 45 }, style: { fill: "#ffeeaa", textColor: "#29261e" } } as MinimapObject;
it("projects negative/rotated objects and navigation round-trips without changing zoom", () => {
 const map = minimapGeometry([object], viewport, frame);
 const world = { x: -2300, y: -800 };
 const next = minimapPan({x:world.x*map.scale+map.offsetX,y:world.y*map.scale+map.offsetY},map,viewport,frame);
 expect(next.zoom).toBe(.5);
 expect((frame.width/2-next.panX)/next.zoom).toBeCloseTo(world.x);
 expect((frame.height/2-next.panY)/next.zoom).toBeCloseTo(world.y);
 expect(map.scale).toBeGreaterThan(0);
});
it("opens a minimap instead of silently fitting the board, and retains explicit fit", () => {
 const fit = vi.fn();
 render(<BoardViewportControls zoom={.5} onZoom={vi.fn()} onFitBoard={fit} onFitSelection={vi.fn()} hasSelection={false} minimap={<BoardMinimap objects={[]} viewport={viewport} frame={frame} onViewportChange={vi.fn()}/>}/>);
 expect(screen.queryByTestId("board-minimap")).toBeNull();
 fireEvent.click(screen.getByTestId("board-overview-fit"));
 expect(screen.getByTestId("board-minimap")).toBeVisible();
 expect(screen.getByText("空白画布")).toBeVisible();
 expect(fit).not.toHaveBeenCalled();
 fireEvent.click(screen.getByTestId("board-zoom-fit-board"));
 expect(fit).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByTestId("board-overview-fit"));
 expect(screen.queryByTestId("board-minimap")).toBeNull();
});
it("supports keyboard navigation without mutating object state", () => {
 const changed=vi.fn(); render(<BoardMinimap objects={[object]} viewport={viewport} frame={frame} onViewportChange={changed}/>);
 fireEvent.keyDown(screen.getByTestId("board-minimap"),{key:"ArrowRight"});
 expect(changed).toHaveBeenCalledWith({...viewport,panX:320});
});
it("maps pointer navigation through the displayed thumbnail, including drag", () => {
 const changed=vi.fn(); render(<BoardMinimap objects={[object]} viewport={viewport} frame={frame} onViewportChange={changed}/>);
 const svg=screen.getByTestId("board-minimap");
 vi.spyOn(svg,"getBoundingClientRect").mockReturnValue({left:100,top:50,width:240,height:160} as DOMRect);
 const map=minimapGeometry([object],viewport,frame);
 fireEvent.pointerDown(svg,{button:0,pointerId:7,clientX:220,clientY:130});
 expect(changed).toHaveBeenLastCalledWith(minimapPan({x:120,y:80},map,viewport,frame));
 fireEvent.pointerMove(svg,{pointerId:7,clientX:240,clientY:140});
 expect(changed).toHaveBeenLastCalledWith(minimapPan({x:140,y:90},map,viewport,frame));
 fireEvent.pointerUp(svg,{pointerId:7});const count=changed.mock.calls.length;
 fireEvent.pointerMove(svg,{pointerId:7,clientX:260,clientY:150});expect(changed).toHaveBeenCalledTimes(count);
});
it("uses the Fabric top-left rotation origin for quarter-turn bounds",()=>{
 const rotated={...object,geometry:{x:500,y:100,width:200,height:100,rotation:90}};
 const map=minimapGeometry([rotated],{zoom:1,panX:0,panY:0,fitRequest:0},{width:100,height:100});
 expect(map.scale).toBeCloseTo(216/500);expect(map.offsetX).toBeCloseTo(12);
});

it("shares real object projection and overlay layering between the navigator and placement scenes", () => {
 const ellipse = {...object,id:"ellipse",kind:"ellipse",geometry:{...object.geometry,x:100,rotation:90},style:{}} as MinimapObject;
 const hidden = {...object,id:"hidden",hidden:true};
 const objects=[object,ellipse,hidden];
 const map=minimapGeometry(objects,viewport,frame);
 const pressed=vi.fn();
 render(<><BoardMinimap objects={objects} viewport={viewport} frame={frame} onViewportChange={vi.fn()}/><BoardMinimapScene objects={objects} map={map} data-testid="placement-scene" aria-label="插入位置预览" className="placement-thumbnail" onPointerDown={pressed}><rect data-testid="placement-overlay" x={12} y={24} width={40} height={30}/></BoardMinimapScene></>);
 const navigator=screen.getByTestId("board-minimap");
 const placement=screen.getByTestId("placement-scene");
 const navigatorRects=Array.from(navigator.querySelectorAll("rect")).slice(0,-1);
 const placementRects=Array.from(placement.querySelectorAll("rect")).slice(0,-1);
 expect(placementRects).toHaveLength(2);
 expect(placementRects.map(rect=>rect.outerHTML)).toEqual(navigatorRects.map(rect=>rect.outerHTML));
 expect(placementRects[0]).toHaveAttribute("fill","#ffeeaa");
 expect(placementRects[0]).toHaveAttribute("transform",`rotate(45 ${object.geometry.x*map.scale+map.offsetX} ${object.geometry.y*map.scale+map.offsetY})`);
 expect(placementRects[1]).toHaveAttribute("rx","20");
 expect(placementRects[1]).toHaveAttribute("fill","#a1a1aa");
 expect(placementRects[1]).toHaveAttribute("stroke","#a1a1aa");
 expect(placement.lastElementChild).toBe(screen.getByTestId("placement-overlay"));
 expect(placement).toHaveAttribute("viewBox","0 0 240 160");
 expect(placement).toHaveAttribute("preserveAspectRatio","none");
 expect(placement).toHaveAccessibleName("插入位置预览");
 expect(placement).toHaveClass("placement-thumbnail");
 fireEvent.pointerDown(placement,{pointerId:1,button:0});
 expect(pressed).toHaveBeenCalledOnce();
});
it("shows the shared empty scene when every object is hidden and retains overlay children", () => {
 const objects=[{...object,hidden:true}];
 render(<BoardMinimapScene objects={objects} map={minimapGeometry(objects,viewport,frame)} data-testid="empty-placement"><rect data-testid="empty-overlay"/></BoardMinimapScene>);
 expect(screen.getByText("空白画布")).toBeVisible();
 expect(screen.getByTestId("empty-placement").querySelectorAll("rect")).toHaveLength(1);
 expect(screen.getByTestId("empty-overlay")).toBeVisible();
});
