import { describe, expect, it } from "vitest";
import { resolveProjectContext } from "@/lib/project-context";
describe("真实项目上下文", () => {
  it.each(["/studio/survey", "/studio/survey/new", "/studio/survey/saved-id", "/projects", "/research", "/itv", "/chat"])("%s 不虚构项目", path => { expect(resolveProjectContext(path)).toBeNull(); });
  it("保留显式项目路由与项目对话", () => {
    expect(resolveProjectContext("/projects/demo")).toEqual({ id: "demo", name: "demo" });
    expect(resolveProjectContext("/projects/real-id/overview")).toEqual({ id: "real-id", name: "real-id" });
    expect(resolveProjectContext("/chat", "real-id")).toEqual({ id: "real-id", name: "real-id" });
  });
});
