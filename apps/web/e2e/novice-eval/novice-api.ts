import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page, Route } from "@playwright/test";
import { routeDrafts, routeInbox, routeDesignWorkbench } from "../../scripts/lib/design-loop-fixtures.mjs";

/**
 * 普通用户评测集的接口替身：在共享夹具（`design-loop-fixtures.mjs`，4 条 CI 用例共用的单一事实源）
 * **之上**叠两条路由，不改共享夹具本身。
 *
 * · `POST /pm-designs`：新建返回一个真正进入列表的项目（共享夹具的新建不入列表）；
 * · `POST /pm-designs/:id/chat`（只拦本文件建出来的项目）：首轮生成回放 `recorded/` 里
 *   **真实模型原样录下的输出**，并故意晚一点返回，让「生成中」那一段真的被看到。
 *
 * Playwright 后注册的路由先匹配；不是本文件负责的请求 `route.fallback()` 交回共享夹具。
 * 共享夹具返回的 `projects` 是它闭包里那份活数组——往里 push，列表 / 详情读到的就是同一份。
 */
export interface RecordedCase {
  readonly brief: string;
  readonly name: string;
  readonly reply: string;
  readonly accent: string;
  readonly tokens: Record<string, unknown>;
  readonly frames: readonly string[];
  readonly prototype: readonly unknown[];
  readonly frameNotes: readonly string[];
  readonly frameLinks: readonly unknown[];
}

export function loadRecorded(name: "psych-app" | "book-market"): RecordedCase {
  return JSON.parse(readFileSync(join(process.cwd(), "e2e", "novice-eval", "recorded", `${name}.json`), "utf8")) as RecordedCase;
}

type Proj = Record<string, unknown> & { id: string };

export async function routeNovice(
  page: Page,
  opts: { readonly recorded?: RecordedCase; readonly empty?: boolean; readonly failList?: boolean; readonly generateMs?: number } = {},
): Promise<Proj[]> {
  await routeDrafts(page, { empty: opts.empty ?? false });
  await routeInbox(page, { empty: opts.empty ?? false });
  const projects = (await routeDesignWorkbench(page, { empty: opts.empty ?? false, failList: opts.failList ?? false })) as Proj[];
  const recorded = opts.recorded;
  const created = new Set<string>();
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  await page.route((url) => new URL(url).pathname === "/pm-designs", async (route) => {
    if (route.request().method() !== "POST" || recorded === undefined) return route.fallback();
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    if (typeof body.name !== "string" || body.name.trim() === "") return json(route, { reasonCode: "NAME_REQUIRED" }, 400);
    const now = "2026-09-27T02:00:00.000Z";
    const project: Proj = {
      id: `novice-${String(created.size + 1)}`, name: body.name, template: body.template ?? "mobile",
      problem: body.problem ?? "", criteria: [], frames: [], prototype: [], frameNotes: [],
      pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null,
      chat: [], theme: "light", tags: body.tags ?? [], refImages: [], share: null,
      accent: "neutral", tokens: { brand: null, font: "sans", radius: "default", density: "default" },
      ownerId: "u-pm-1", ownerName: "苏木 · PM", createdAt: now, updatedAt: now,
    };
    created.add(project.id);
    projects.unshift(project);
    return json(route, { project }, 201);
  });

  await page.route((url) => /^\/pm-designs\/[^/]+\/chat$/.test(new URL(url).pathname), async (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[2]!);
    const project = projects.find((p) => p.id === id);
    if (!created.has(id) || project === undefined || recorded === undefined) return route.fallback();
    const body = (route.request().postDataJSON() ?? {}) as { text?: string };
    await new Promise((r) => setTimeout(r, opts.generateMs ?? 2500));
    Object.assign(project, {
      frames: [...recorded.frames], prototype: structuredClone(recorded.prototype), frameNotes: [...recorded.frameNotes],
      frameLinks: structuredClone(recorded.frameLinks), accent: recorded.accent,
      tokens: { brand: null, font: "sans", radius: "default", density: "default", ...recorded.tokens },
      chat: [
        { role: "user", text: body.text ?? "", at: "2026-09-27T02:00:01.000Z" },
        { role: "ai", text: recorded.reply, at: "2026-09-27T02:00:30.000Z", source: "model" },
      ],
      updatedAt: "2026-09-27T02:00:30.000Z",
    });
    return json(route, { project, reply: { source: "model", applied: ["prototype"], suggestions: [] } });
  });

  /*
   * 共享夹具没有拦「恢复到某一版」（`POST …/versions/:versionId/restore`）——撤销与找回旧版都走它，
   * 不补的话这两条旅程在评测里**必然**失败，扣的是夹具的分不是产品的分。
   * 旧版本内容经**页面自己的路由**取（`GET …/versions/:id` 由共享夹具应答），不在这里再抄一份版本数据。
   */
  await page.route((url) => /^\/pm-designs\/[^/]+\/versions\/[^/]+\/restore$/.test(new URL(url).pathname), async (route) => {
    const [, , id, , versionId] = new URL(route.request().url()).pathname.split("/").map(decodeURIComponent);
    const project = projects.find((p) => p.id === id);
    if (project === undefined) return json(route, { reasonCode: "PROJECT_NOT_FOUND" }, 404);
    const got = await page.evaluate(async (path) => {
      const r = await fetch(path);
      return r.ok ? ((await r.json()) as { version: Record<string, unknown> }).version : null;
    }, `/pm-designs/${encodeURIComponent(id!)}/versions/${encodeURIComponent(versionId!)}`);
    if (got === null) return json(route, { reasonCode: "VERSION_NOT_FOUND" }, 404);
    Object.assign(project, { prototype: structuredClone(got.prototype), frames: got.frames, frameNotes: got.notes ?? project.frameNotes, updatedAt: "2026-09-27T03:00:00.000Z" });
    const { prototype: _p, ...summary } = got;
    return json(route, { project, version: summary });
  });

  return projects;
}
