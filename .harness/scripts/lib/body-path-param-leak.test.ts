import { describe, expect, it } from "vitest";
import { analyzeBodyPathParamLeaks, allowlistKey, staleAllowlistEntries } from "./body-path-param-leak";

/**
 * F961 复核发现的真 bug（PR #1549）的机械门（issue #1580）。fixture 只用最小字符串，
 * 不依赖真实文件——判定逻辑本身要能被单测覆盖，见 `lib/rewrite-coverage.test.ts` 先例。
 */
describe("analyzeBodyPathParamLeaks", () => {
  it("body 里带路径参数名 ⇒ 报一条 gap（复现 F950 的真 bug 形状）", () => {
    const source = `
      export async function saveProjectTopic(input) {
        return apiRequest(
          templates.operations.saveAndSyncTopic.path.replace(":projectId", encodeURIComponent(input.projectId)),
          {
            method: "PUT",
            body: {
              projectId: input.projectId,
              title: input.title,
              background: input.background,
            },
          },
        );
      }
    `;
    const report = analyzeBodyPathParamLeaks([{ file: "lib/live-project-prep.ts", source }]);
    expect(report.incomplete).toBe(false);
    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0]).toMatchObject({ file: "lib/live-project-prep.ts", param: "projectId" });
  });

  it("body 里不带路径参数名 ⇒ 干净（F961 修复后的真实形状）", () => {
    const source = `
      export async function saveProjectTopic(input) {
        return apiRequest(
          templates.operations.saveAndSyncTopic.path.replace(":projectId", encodeURIComponent(input.projectId)),
          {
            method: "PUT",
            body: {
              title: input.title,
              background: input.background,
              expectedTopicRevision: input.expectedTopicRevision,
              aiGenerated: null,
            },
          },
        );
      }
    `;
    const report = analyzeBodyPathParamLeaks([{ file: "lib/live-project-prep.ts", source }]);
    expect(report.gaps).toHaveLength(0);
  });

  it("路径构造函数与发起请求的调用点分在两处（`subjectsPath` 那种形状）也能抓到", () => {
    const source = `
      function subjectsPath(projectId, groupId) {
        return templates.operations.getInterviewSubjects.path
          .replace(":projectId", encodeURIComponent(projectId))
          .replace(":groupId", encodeURIComponent(groupId));
      }

      export async function saveInterviewSubjects(input) {
        return apiRequest(subjectsPath(input.projectId, input.groupId), {
          method: "PUT",
          body: {
            groupId: input.groupId,
            subjects: input.subjects,
            expectedRevision: input.expectedRevision,
          },
        });
      }
    `;
    const report = analyzeBodyPathParamLeaks([{ file: "lib/live-project-prep.ts", source }]);
    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0]?.param).toBe("groupId");
  });

  it("没有路径参数替换的文件 ⇒ 本判据不适用，不报 gap", () => {
    const source = `
      export async function listSomething() {
        return apiRequest("/things", { method: "POST", body: { name: "x" } });
      }
    `;
    const report = analyzeBodyPathParamLeaks([{ file: "lib/live-things.ts", source }]);
    expect(report.gaps).toHaveLength(0);
  });

  it("同一文件里另一个函数用了同名路径参数，但这次调用本身没有路径参数 ⇒ 不牵连（live-canvas.ts 的真实反证）", () => {
    // v1（按文件聚合）在真实仓库上当场假阳性的那个形状：createCanvasTemplate 是
    // POST、没有任何路径参数，`key` 是新建时选的业务字段；而同文件里别的函数
    // （更新一个已存在模板）用了 `.replace(":key", ...)`。按调用点判定就不会误伤。
    const source = `
      export async function createCanvasTemplate(input) {
        return apiRequest(canvas.operations.createTemplate.path, {
          method: "POST",
          body: {
            key: input.key,
            displayName: input.displayName,
          },
        });
      }

      export async function updateCanvasTemplate(input) {
        return apiRequest(
          canvas.operations.updateTemplate.path.replace(":key", encodeURIComponent(input.key)),
          { method: "PUT", body: { displayName: input.displayName } },
        );
      }
    `;
    const report = analyzeBodyPathParamLeaks([{ file: "lib/live-canvas.ts", source }]);
    expect(report.gaps).toHaveLength(0);
  });

  it("body 是嵌套数组里的实体字段，恰好同名也算命中——刻意的保守方向（见文件头注）", () => {
    const source = `
      export async function saveProjectGrouping(input) {
        return apiRequest(
          templates.operations.updateGrouping.path.replace(":projectId", encodeURIComponent(input.projectId)),
          {
            method: "PUT",
            body: {
              groups: input.groups,
              expectedRevision: input.expectedRevision,
            },
          },
        );
      }
    `;
    const report = analyzeBodyPathParamLeaks([{ file: "lib/live-project-prep.ts", source }]);
    expect(report.gaps).toHaveLength(0);
  });

  it("空输入 ⇒ incomplete，不判定为「没有泄漏」", () => {
    const report = analyzeBodyPathParamLeaks([]);
    expect(report.incomplete).toBe(true);
  });

  it("同一文件多个调用，只有其中一个泄漏 ⇒ 只报那一条", () => {
    const source = `
      export async function a(input) {
        return apiRequest(P.replace(":projectId", input.projectId), {
          method: "PUT",
          body: { title: input.title },
        });
      }
      export async function b(input) {
        return apiRequest(P.replace(":projectId", input.projectId), {
          method: "PUT",
          body: { projectId: input.projectId, title: input.title },
        });
      }
    `;
    const report = analyzeBodyPathParamLeaks([{ file: "lib/live-x.ts", source }]);
    expect(report.gaps).toHaveLength(1);
  });

  it("GET 请求没有 body ⇒ 不报（哪怕路径带参数）", () => {
    const source = `
      export async function getProjectTopic(projectId) {
        return apiRequest(
          templates.operations.getProjectTopic.path.replace(":projectId", encodeURIComponent(projectId)),
          { method: "GET" },
        );
      }
    `;
    const report = analyzeBodyPathParamLeaks([{ file: "lib/live-project-prep.ts", source }]);
    expect(report.gaps).toHaveLength(0);
  });

  it("apiRequest<T>(...) 泛型调用形态也能抓到（hotfix 反证：live-projects.ts 上线当天漏了这个形态）", () => {
    const source = `
      export async function createAgendaSegment(input) {
        const op = project.operations.createAgendaSegment;
        return apiRequest<CreateAgendaSegmentOut>(
          op.path.replace(":workshopId", encodeURIComponent(input.workshopId)),
          {
            method: "POST",
            body: {
              workshopId: input.workshopId,
              title: input.title,
            },
          },
        );
      }
    `;
    const report = analyzeBodyPathParamLeaks([{ file: "lib/live-projects.ts", source }]);
    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0]?.param).toBe("workshopId");
  });

  it("allowlist 命中的条目不报（合法冗余：controller 用全量 .in，本来就要求 body 里再传一次）", () => {
    const source = `
      export async function createAgendaSegment(input) {
        return apiRequest<Out>(
          P.replace(":workshopId", encodeURIComponent(input.workshopId)),
          { method: "POST", body: { workshopId: input.workshopId, title: input.title } },
        );
      }
    `;
    const allowlist = new Set([allowlistKey("lib/live-projects.ts", "workshopId")]);
    const report = analyzeBodyPathParamLeaks([{ file: "lib/live-projects.ts", source }], allowlist);
    expect(report.gaps).toHaveLength(0);
  });

  it("staleAllowlistEntries：条目已经不再泄漏 ⇒ 判陈旧，要求删掉", () => {
    const source = `
      export async function saveProjectTopic(input) {
        return apiRequest(P.replace(":projectId", input.projectId), {
          method: "PUT",
          body: { title: input.title },
        });
      }
    `;
    const allowlist = new Set([allowlistKey("lib/live-project-prep.ts", "projectId")]);
    const stale = staleAllowlistEntries([{ file: "lib/live-project-prep.ts", source }], allowlist);
    expect(stale).toEqual([allowlistKey("lib/live-project-prep.ts", "projectId")]);
  });

  it("staleAllowlistEntries：条目仍在真实泄漏 ⇒ 不判陈旧", () => {
    const source = `
      export async function createAgendaSegment(input) {
        return apiRequest(P.replace(":workshopId", input.workshopId), {
          method: "POST",
          body: { workshopId: input.workshopId },
        });
      }
    `;
    const allowlist = new Set([allowlistKey("lib/live-projects.ts", "workshopId")]);
    const stale = staleAllowlistEntries([{ file: "lib/live-projects.ts", source }], allowlist);
    expect(stale).toEqual([]);
  });
});
