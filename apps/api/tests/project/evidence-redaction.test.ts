/**
 * 项目中枢 B3-T5（#4499）—— `redactEvidenceForRole` 的 domain 断言（纯函数，不需要 Postgres）。
 *
 * 钉住：观察者 ⇒ speakerLabel 抹成 null、excerpt 截到 80 字加「…」、locator 与其余字段原样；
 * 恰好 80 字不截；按码点截（不撕开代理对）；其余三种角色与 null 原样返回**同一个对象**；
 * 不改传入对象；输出仍过契约 `ProjectEvidenceItem`。
 */
import { describe, expect, it } from "vitest";
import { projectEvidence as C } from "@repo/contracts";
import {
  EXCERPT_ELLIPSIS,
  OBSERVER_EXCERPT_LIMIT,
  redactEvidenceForRole,
  type ProjectEvidenceItem,
} from "../../src/domain/project/evidence-redaction";

const LONG = "甲".repeat(120);

const item = (excerpt = LONG): ProjectEvidenceItem => ({
  id: "ev_1",
  projectId: "p1",
  sourceKind: "interview_segment",
  resourceId: "itv-1",
  sourceRef: "seg-9",
  excerpt,
  locator: { ordinal: 9, startMs: 1200, endMs: 4800 },
  speakerLabel: "受访者 A",
  resourceTitle: "访谈一",
  revoked: false,
  createdAt: "2026-09-27T00:00:00.000Z",
});

describe("observer", () => {
  it("speakerLabel 抹成 null，excerpt 截到 80 字加「…」，locator 与其余字段原样", () => {
    const src = item();
    const out = redactEvidenceForRole(src, "observer");
    expect(out.speakerLabel).toBeNull();
    expect(Array.from(out.excerpt)).toHaveLength(OBSERVER_EXCERPT_LIMIT + 1);
    expect(out.excerpt).toBe("甲".repeat(80) + EXCERPT_ELLIPSIS);
    expect(out.locator).toEqual(src.locator);
    const { speakerLabel: _s, excerpt: _e, ...rest } = src;
    expect(out).toMatchObject(rest);
    expect(C.ProjectEvidenceItem.parse(out)).toEqual(out);
    // 不改传入对象。
    expect(src.speakerLabel).toBe("受访者 A");
    expect(src.excerpt).toBe(LONG);
  });

  it("恰好 80 字不截；81 字才截", () => {
    expect(redactEvidenceForRole(item("乙".repeat(80)), "observer").excerpt).toBe("乙".repeat(80));
    expect(redactEvidenceForRole(item("乙".repeat(81)), "observer").excerpt).toBe("乙".repeat(80) + EXCERPT_ELLIPSIS);
  });

  it("按码点截：代理对（emoji）不被撕开", () => {
    const out = redactEvidenceForRole(item("😀".repeat(100)), "observer");
    expect(Array.from(out.excerpt)).toHaveLength(81);
    expect(out.excerpt.startsWith("😀".repeat(80))).toBe(true);
    expect(out.excerpt.endsWith(EXCERPT_ELLIPSIS)).toBe(true);
  });

  it("匿名（speakerLabel 本来就是 null）与短摘录也照常处理", () => {
    const out = redactEvidenceForRole({ ...item("短"), speakerLabel: null }, "observer");
    expect(out).toEqual({ ...item("短"), speakerLabel: null });
  });
});

describe("其它角色", () => {
  it.each(["facilitator", "groupLead", "member", null] as const)("%s ⇒ 原样返回同一个对象", (role) => {
    const src = item();
    expect(redactEvidenceForRole(src, role)).toBe(src);
  });
});
