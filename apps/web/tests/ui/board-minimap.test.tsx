import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
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
