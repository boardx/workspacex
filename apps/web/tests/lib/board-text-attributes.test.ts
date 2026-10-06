import { describe, expect, it } from "vitest";
import { boardTextAttributes } from "../../components/whiteboard/board-text-attributes";
describe("board text baseline", () => {
 it("creates standalone text at top for all presets", () => { for(const preset of ["body","title","heading","caption"] as const) expect(boardTextAttributes("text",{preset}).verticalAlignment).toBe("top"); });
 it("keeps legacy format updates and explicit misplaced text at top", () => { expect(boardTextAttributes("text",{preset:"body",bold:true,fontSize:28}).verticalAlignment).toBe("top");expect(boardTextAttributes("text",{preset:"body",verticalAlignment:"middle"}).verticalAlignment).toBe("top"); });
 it("preserves sticky middle default and explicit bottom", () => {expect(boardTextAttributes("sticky",{preset:"body"}).verticalAlignment).toBe("middle");expect(boardTextAttributes("sticky",{preset:"body",verticalAlignment:"bottom"}).verticalAlignment).toBe("bottom");});
});
