// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WhiteboardObject } from "@repo/whiteboard-core";
import { BoardSelectedObjectPanel } from "@/components/whiteboard/board-selected-object-panel";
import { boardToolbarPosition } from "@/components/whiteboard/use-board-toolbar-position";

const viewport = { zoom: 1, panX: 0, panY: 0, fitRequest: 0 };
const kinds = ["sticky", "text", "rectangle", "drawing", "image", "connector"] as const;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("independent selection toolbar object-relative positioning", () => {
  for (const width of [390, 1440]) {
    for (const kind of kinds) {
      it(`${kind} at ${width}px preserves placement above the selected object`, () => {
        vi.stubGlobal("innerWidth", width);
        vi.stubGlobal("innerHeight", 900);
        const geometry = { x: width / 2 - 60, y: 320, width: 120, height: 100, rotation: 0 };
        const object: WhiteboardObject = {
          id: kind, schemaVersion: 1, kind, parentId: null, orderKey: "a", geometry, style: {}, text: "fixture",
          ...(kind === "connector" ? { connector: {
            fromPoint: { x: geometry.x, y: geometry.y }, toPoint: { x: geometry.x + geometry.width, y: geometry.y + geometry.height },
            fromAnchor: "right" as const, toAnchor: "left" as const, type: "straight" as const,
            startStyle: "none" as const, endStyle: "arrow" as const, lineStyle: "solid" as const, label: "", semanticRelation: "",
          } } : {}),
        };
        const measuredToolbar = { width: Math.min(430, width - 32), height: 44 };
        const expected = boardToolbarPosition(geometry, viewport, { width, height: 900 }, measuredToolbar);
        expect(Number(expected.top) + measuredToolbar.height).toBeLessThan(geometry.y);
        render(<BoardSelectedObjectPanel title="fixture" typeLabel={kind} object={object} readOnly={false}
          onClose={vi.fn()} onGeometryChange={vi.fn()} floatingStyle={expected} compactActions={<button>Action</button>}>
          <span>Properties</span>
        </BoardSelectedObjectPanel>);
        const panel = screen.getByTestId("board-context-toolbar");
        expect(panel.style.top).toBe(`${expected.top}px`);
        expect(panel.style.left).toBe(`${expected.left}px`);
        // A Tailwind !top-auto or fixed bottom utility would override inline placement in a browser.
        expect(panel.className).not.toMatch(/max-sm:!top-auto|max-sm:!bottom-/);
      });
    }
    it(`uses a below-object fallback near the viewport header at ${width}px`, () => {
      const geometry = { x: width / 2 - 60, y: 76, width: 120, height: 100 };
      const toolbar = { width: Math.min(430, width - 32), height: 44 };
      const position = boardToolbarPosition(geometry, viewport, { width, height: 900 }, toolbar);
      expect(Number(position.top)).toBeGreaterThanOrEqual(geometry.y + geometry.height + 12);
      expect(Number(position.left)).toBeGreaterThanOrEqual(16);
      expect(Number(position.left) + toolbar.width).toBeLessThanOrEqual(width - 16);
    });
  }
});

it('clamps a newly expanded Frame immediately using its actual width instead of the previous compact width',()=>{
 vi.stubGlobal('innerWidth',390);vi.stubGlobal('innerHeight',1000);
 const object:WhiteboardObject={id:'frame',schemaVersion:1,kind:'frame',parentId:null,orderKey:'a',geometry:{x:160,y:400,width:100,height:80,rotation:0},style:{},text:'Frame'};
 render(<BoardSelectedObjectPanel title="Frame" typeLabel="Frame" object={object} readOnly={false} onClose={vi.fn()} onGeometryChange={vi.fn()} floatingStyle={{left:122.4375,top:900}} compactActions={<button>Action</button>}><span>Properties</span></BoardSelectedObjectPanel>);
 fireEvent.click(screen.getByTestId('board-inspector-expand'));
 const panel=screen.getByTestId('board-context-toolbar');
 expect(panel).toHaveAttribute('data-expanded','true');
 expect(panel).toHaveStyle({left:'54px',top:'544px','--board-inspector-width':'320px'});
});
