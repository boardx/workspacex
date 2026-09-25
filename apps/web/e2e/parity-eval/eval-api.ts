/**
 * 对标评测的「编辑与历史」API 替身：在 `routeDesignWorkbench` 交出的**同一份**活数据上，
 * 用**真实契约函数** `applyPrototypePatch` 应用 patch，并维护 append-only 的版本日志（含恢复）。
 *
 * 为什么不用 `design-loop-fixtures.mjs` 里那条 patch 路由：它只实现了 `setProps`、也没有恢复版本，
 * 而评测要量的正是「移动 / 替换 / 撤销 / 重做」这些——用一个比真实 API 更弱的替身去量，
 * 量出来的差距一半是替身自己的。这里的语义逐条对齐 `apps/api` 的 `patchPrototype`：
 * 整批顺序执行、任一条不合法整批拒、每次成功写一版快照。
 */
import type { Page, Route } from "@playwright/test";
import { applyPrototypePatch, DesignPrototypePatch, PrototypePatchError } from "../../../../packages/contracts/src/design-prototype";

import type { FixtureProject as EvalProject } from "../../scripts/lib/design-loop-fixtures.mjs";
interface Version { id: string; seq: number; source: string; summary: string; createdAt: string; frames: string[]; notes: string[]; prototype: unknown[]; frameLinks: unknown[][] }

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const snapshot = (p: EvalProject, seq: number, summary: string, source = "user"): Version => ({
  id: `${p.id}-v${seq}`, seq, source, summary, createdAt: new Date(Date.UTC(2026, 8, 23, 2, 0, seq)).toISOString(),
  frames: [...p.frames], notes: [...p.frameNotes], prototype: structuredClone(p.prototype),
  frameLinks: structuredClone(p.frameLinks ?? p.frames.map(() => [])),
});

/** 在 eval-* 项目上接管 patch / versions / restore。其它项目仍走夹具原有路由。 */
export async function routeEvalEditing(page: Page, projects: EvalProject[]): Promise<void> {
  const logs = new Map<string, Version[]>();
  const logOf = (p: EvalProject) => {
    if (!logs.has(p.id)) logs.set(p.id, [snapshot(p, 1, "初版", "model")]);
    return logs.get(p.id)!;
  };
  const find = (url: string) => {
    const id = decodeURIComponent(new URL(url).pathname.split("/")[2] ?? "");
    return id.startsWith("eval-") ? projects.find((p) => p.id === id) ?? null : null;
  };

  await page.route((url) => /^\/pm-designs\/eval-[^/]+\/prototype\/patch$/.test(url.pathname), async (route) => {
    const p = find(route.request().url());
    if (p === null) return json(route, { reasonCode: "PROJECT_NOT_FOUND" }, 404);
    const body = (route.request().postDataJSON() ?? {}) as { ops?: unknown; summary?: string };
    const parsed = DesignPrototypePatch.safeParse(body.ops);
    if (!parsed.success) return json(route, { reasonCode: "VALIDATION_FAILED", rejectReason: "INVALID_OP" }, 400);
    logOf(p);
    const screens = p.frames.map((frame, i) => ({
      frame, notes: p.frameNotes[i] ?? "", links: (p.frameLinks?.[i] ?? []) as never[],
      ...(p.prototype[i] != null ? { root: p.prototype[i] as never } : {}),
    }));
    try {
      const next = applyPrototypePatch(screens, parsed.data);
      p.frames = next.map((s) => (s as { frame: string }).frame);
      p.prototype = next.map((s) => s.root ?? null);
      p.frameNotes = next.map((s) => (s as { notes?: string }).notes ?? "");
      p.frameLinks = next.map((s) => [...s.links]);
      p.updatedAt = new Date().toISOString();
      const log = logOf(p);
      log.push(snapshot(p, log.length + 1, body.summary ?? "手动修改"));
      return json(route, { project: p });
    } catch (err) {
      const reason = err instanceof PrototypePatchError ? err.reason : "INVALID_OP";
      return json(route, { reasonCode: "PROTOTYPE_PATCH_REJECTED", rejectReason: reason }, 400);
    }
  });

  await page.route((url) => /^\/pm-designs\/eval-[^/]+\/versions$/.test(url.pathname), (route) => {
    const p = find(route.request().url());
    if (p === null) return json(route, { reasonCode: "PROJECT_NOT_FOUND" }, 404);
    return json(route, { items: [...logOf(p)].reverse().map(({ prototype: _t, frameLinks: _l, ...rest }) => rest) });
  });

  await page.route((url) => /^\/pm-designs\/eval-[^/]+\/versions\/[^/]+$/.test(url.pathname), (route) => {
    const p = find(route.request().url());
    const vid = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[4] ?? "");
    const v = p === null ? undefined : logOf(p).find((x) => x.id === vid);
    if (v === undefined) return json(route, { reasonCode: "VERSION_NOT_FOUND" }, 404);
    return json(route, { version: v });
  });

  await page.route((url) => /^\/pm-designs\/eval-[^/]+\/versions\/[^/]+\/restore$/.test(url.pathname), (route) => {
    const p = find(route.request().url());
    const vid = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[4] ?? "");
    const log = p === null ? [] : logOf(p);
    const v = log.find((x) => x.id === vid);
    if (p === null || v === undefined) return json(route, { reasonCode: "VERSION_NOT_FOUND" }, 404);
    p.frames = [...v.frames]; p.frameNotes = [...v.notes]; p.prototype = structuredClone(v.prototype); p.frameLinks = structuredClone(v.frameLinks);
    // 恢复也是一版（契约 D4：append-only）。
    log.push(snapshot(p, log.length + 1, `恢复到第 ${v.seq} 版`, "restore"));
    return json(route, { project: p });
  });
}
