import { describe, expect, it } from "vitest";
import {
  AIDT_BRAINSTORM_METHOD_GUIDES, AIDT_BRAINSTORM_METHOD_REGISTRY, AIDT_BRAINSTORM_METHODS,
  AidtBrainstorm, readAidtBrainstorm, type AidtBrainstormMethod,
} from "../src/aidt-brainstorm";

const methods: AidtBrainstormMethod[] = ["free", "reverse", "scamper", "analogy", "role", "brainwriting"];
const source = { id: "hmw-original", revision: 4, text: "我们如何帮助午休赶课的学生理解等待信息？" };
const row = (method: AidtBrainstormMethod, count = 5) => ({ id: "brainstorm-one", source, method, count, candidates: [] });

describe("one brainstorming method registry feeds labels, guide and persisted validation", () => {
  it("covers exactly the six requested stable keys, each with a distinct strategy and student first prompt", () => {
    expect(Object.keys(AIDT_BRAINSTORM_METHOD_REGISTRY)).toEqual(methods);
    expect(Object.keys(AIDT_BRAINSTORM_METHODS)).toEqual(methods);
    expect(Object.keys(AIDT_BRAINSTORM_METHOD_GUIDES)).toEqual(methods);
    expect(new Set(methods.map(key => AIDT_BRAINSTORM_METHOD_GUIDES[key].description)).size).toBe(methods.length);
    expect(new Set(methods.map(key => AIDT_BRAINSTORM_METHOD_GUIDES[key].startPrompt)).size).toBe(methods.length);
    for (const method of methods) {
      const entry = AIDT_BRAINSTORM_METHOD_REGISTRY[method];
      expect(AIDT_BRAINSTORM_METHODS[method]).toBe(entry.label);
      expect(AIDT_BRAINSTORM_METHOD_GUIDES[method]).toMatchObject({ description: entry.description, startPrompt: entry.startPrompt });
      expect(entry.description.length).toBeGreaterThan(20);
      expect(entry.startPrompt.length).toBeGreaterThan(15);
    }
  });
  it.each(methods)("reads an explicit %s saved scene without changing its frozen HMW or choice", method => {
    const original = row(method);
    expect(AidtBrainstorm.parse(original)).toEqual(original);
    expect(readAidtBrainstorm({ "ideaBrainstorm:brainstorm-one": JSON.stringify(original) }, original.id)).toEqual(original);
  });
  it.each(["free", "reverse", "scamper"] as const)("preserves legacy %s labels and the original 1–24 count range", method => {
    expect(AIDT_BRAINSTORM_METHODS[method]).toBe({ free: "自由联想", reverse: "逆向思考", scamper: "SCAMPER" }[method]);
    for (const count of [1, 7, 24]) expect(AidtBrainstorm.parse(row(method, count)).count).toBe(count);
  });
  it("never defaults a missing/unknown selection and preserves the same 1–24 count range for all six methods", () => {
    expect(AidtBrainstorm.safeParse({ ...row("free"), method: "" }).success).toBe(false);
    expect(AidtBrainstorm.safeParse({ ...row("free"), method: undefined }).success).toBe(false);
    expect(AidtBrainstorm.safeParse({ ...row("free"), method: "auto-best" }).success).toBe(false);
    for (const method of methods) {
      expect(AidtBrainstorm.safeParse(row(method, 1)).success).toBe(true);
      expect(AidtBrainstorm.safeParse(row(method, 24)).success).toBe(true);
    }
  });
  it("records method-specific teaching boundaries rather than inventing product capabilities or evidence", () => {
    expect(AIDT_BRAINSTORM_METHOD_GUIDES.role.description).toContain("待验证的角色假设");
    expect(AIDT_BRAINSTORM_METHOD_GUIDES.brainwriting.description).toContain("各自安静写下点子");
    expect(AIDT_BRAINSTORM_METHOD_GUIDES.brainwriting.description).not.toContain("不声称");
    expect(AIDT_BRAINSTORM_METHOD_GUIDES.analogy.description).toContain("不是用户证据");
    expect(AIDT_BRAINSTORM_METHOD_GUIDES.scamper.description).toContain("由学生选一个切口");
  });
});
