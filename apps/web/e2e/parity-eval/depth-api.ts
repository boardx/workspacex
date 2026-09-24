/**
 * 深度评测（`design-depth.eval.ts`）的 API 替身：批注（服务端存储 + 回复 + 解决）。
 *
 * 与 `eval-api.ts` 同一个原则：替身的语义对齐真实接口要的样子，不比它弱——评测量的是前端有没有
 * 真的用上这些接口（换一个浏览器还看得到、刷新不丢），不是替身本身。
 *
 * ⚠ 这里定义的是**目标接口**：基线时产品还没有这些接口，前端也不会调，检查就失败——那就是差距。
 *   实现那一轮以 `packages/contracts` 的契约为准；契约与这里对不上，改这里并在 README 记一笔。
 */
import type { Page, Route } from "@playwright/test";

export interface EvalReply { id: string; text: string; authorName: string; createdAt: string }
export interface EvalComment {
  id: string; nodeId: string; frameIndex: number; label: string; text: string; resolved: boolean;
  authorName: string; createdAt: string; replies: EvalReply[];
}
/** 一份「服务端」：同一个测试里的几个浏览器上下文共用它，才量得出「换台电脑也看得到」。 */
export type CommentStore = Map<string, EvalComment[]>;
export const newCommentStore = (): CommentStore => new Map();

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const pid = (url: string) => decodeURIComponent(new URL(url).pathname.split("/")[2] ?? "");
const at = (n: number) => new Date(Date.UTC(2026, 8, 24, 3, 0, n)).toISOString();

export async function routeEvalComments(page: Page, store: CommentStore, authorName = "评测用户"): Promise<void> {
  const list = (id: string) => { if (!store.has(id)) store.set(id, []); return store.get(id)!; };
  let seq = 0;
  await page.route((url) => /^\/pm-designs\/eval-[^/]+\/comments$/.test(url.pathname), async (route) => {
    const items = list(pid(route.request().url()));
    if (route.request().method() === "GET") return json(route, { items });
    const b = (route.request().postDataJSON() ?? {}) as Partial<EvalComment>;
    if (typeof b.nodeId !== "string" || typeof b.text !== "string" || typeof b.frameIndex !== "number") return json(route, { reasonCode: "VALIDATION_FAILED" }, 400);
    const c: EvalComment = {
      id: `cm-${items.length + 1}-${++seq}`, nodeId: b.nodeId, frameIndex: b.frameIndex, label: b.label ?? "", text: b.text,
      resolved: false, authorName, createdAt: at(seq), replies: [],
    };
    items.push(c);
    return json(route, { comment: c }, 201);
  });
  await page.route((url) => /^\/pm-designs\/eval-[^/]+\/comments\/[^/]+$/.test(url.pathname), async (route) => {
    const items = list(pid(route.request().url()));
    const cid = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[4] ?? "");
    const i = items.findIndex((c) => c.id === cid);
    if (i < 0) return json(route, { reasonCode: "COMMENT_NOT_FOUND" }, 404);
    if (route.request().method() === "DELETE") { items.splice(i, 1); return json(route, {}); }
    const b = (route.request().postDataJSON() ?? {}) as { resolved?: boolean };
    if (typeof b.resolved === "boolean") items[i] = { ...items[i]!, resolved: b.resolved };
    return json(route, { comment: items[i] });
  });
  await page.route((url) => /^\/pm-designs\/eval-[^/]+\/comments\/[^/]+\/replies$/.test(url.pathname), async (route) => {
    const items = list(pid(route.request().url()));
    const cid = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[4] ?? "");
    const c = items.find((x) => x.id === cid);
    if (c === undefined) return json(route, { reasonCode: "COMMENT_NOT_FOUND" }, 404);
    const b = (route.request().postDataJSON() ?? {}) as { text?: string };
    if (typeof b.text !== "string" || b.text.trim() === "") return json(route, { reasonCode: "VALIDATION_FAILED" }, 400);
    c.replies.push({ id: `rp-${c.replies.length + 1}-${++seq}`, text: b.text, authorName, createdAt: at(seq) });
    return json(route, { comment: c }, 201);
  });
}
