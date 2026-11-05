import { expect, it } from "vitest";
import { sharedFromPersonalLabelZh } from "@repo/contracts/chat-knowledge-graph";
import { projectOriginLabel } from "@/lib/knowledge-graph-recall";
it.each(["", "  项目成员原名 {name}  "])("preserves the contract's default Chinese share-label normalization for %j", name => { const memory = { scope: "project" as const, sharedByName: name }; expect(projectOriginLabel(memory)).toBe(sharedFromPersonalLabelZh(name)); expect(projectOriginLabel(memory, "zh-CN")).toBe(sharedFromPersonalLabelZh(name)); });
it("displays an unnamed project sharer in English while leaving a named caller's original text intact", () => { expect(projectOriginLabel({ scope: "project", sharedByName: "   " }, "en")).toBe("Shared from personal memory by a project member"); const raw = "成员原名 {name}"; expect(projectOriginLabel({ scope: "project", sharedByName: raw }, "en")).toContain(raw); });
