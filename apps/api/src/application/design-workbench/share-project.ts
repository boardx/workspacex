/**
 * 迭代 22 —— `publishProject` / `unpublishProject` / `getSharedDesign`：设计项目的**发布与分享**。
 *
 * ## 令牌形状是照搬的，不是新发明的
 *
 * `<locator>.<secret>`：`locator` 是 base64url 的 `[orgId, projectId]`，**只用来路由**
 * （RLS 按 org 判，没有组织上下文一行都查不出来）；`secret` 是 256 位随机数，在返回任何
 * 内容**之前**用定时安全比较验过。这套形状逐字来自 `survey-service.ts` 的公开问卷令牌——
 * 同一个问题（"免登录、跨租户、不可枚举的只读链接"）在一个仓库里只该有一种解法，
 * 第二种解法意味着以后修一个洞要记得修两处。
 *
 * ## 三条边界，写在这里而不是散在 controller 里
 *
 *   ① 没有画出来的页 ⇒ 拒绝发布（`NOTHING_TO_PUBLISH`）。发一条打开是白屏的链接，
 *      对方只会以为链接坏了——而坏的是这个动作本身在这一刻没有意义。
 *   ② 令牌只在**首次**发布时生成；重新发布沿用同一条链接（换链接会让已经发到别人聊天
 *      记录里的那条静默失效，而你收不回来）。
 *   ③ 公开读**不区分**"令牌不对"和"已取消发布"：都是同一个 404。分开报等于给试令牌的人
 *      一个进度条。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { designWorkbench } from "@repo/contracts";
import type { DesignProjectRepositoryFactory } from "./project-ports";
import {
  DesignProjectNotFoundError,
  DesignProjectNotOwnerError,
  loadProjectView,
  type DesignProjectDeps,
  type DesignProjectView,
} from "./project-shared";
import { hasDrawnScreen, shareSnapshotOf } from "./share-snapshot";

/** 契约 `NOTHING_TO_PUBLISH`：这个项目一页都还没画出来。 */
export class NothingToPublishError extends Error {}
/** 契约 `SHARE_NOT_FOUND`：令牌不对 / 已取消发布 / 项目没了——**同一个出口**，见文件头 ③。 */
export class ShareNotFoundError extends Error {}

/** 令牌里随机那一半的字节数。256 位，同 `survey-service.ts`。 */
const SHARE_SECRET_BYTES = 32;
/** 超过这个长度直接当假的——不解析、不查库（避免拿超长串消耗 base64 解码）。 */
const SHARE_TOKEN_MAX_CHARS = 2048;

export function makeShareToken(orgId: string, projectId: string): string {
  const locator = Buffer.from(JSON.stringify([orgId, projectId])).toString("base64url");
  return `${locator}.${randomBytes(SHARE_SECRET_BYTES).toString("base64url")}`;
}

/**
 * 令牌 → `[orgId, projectId]`。**这一步不构成任何鉴权**——locator 是明文、人人可伪造，
 * 它只决定"去哪一行比对密钥"。真正的门是下面那次 `timingSafeEqual`。
 */
export function parseShareToken(token: string): readonly [string, string] | null {
  try {
    if (token.length > SHARE_TOKEN_MAX_CHARS) return null;
    const parts = token.split(".");
    if (parts.length !== 2 || parts[1] === "") return null;
    const decoded: unknown = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 2) return null;
    const [orgId, projectId] = decoded as unknown[];
    if (typeof orgId !== "string" || typeof projectId !== "string") return null;
    if (orgId === "" || projectId === "" || orgId.length > 200 || projectId.length > 200) return null;
    return [orgId, projectId] as const;
  } catch {
    return null;
  }
}

/**
 * 定长比较——先各自 sha256 再 `timingSafeEqual`。
 * 直接比两个长度不同的 Buffer 会让 `timingSafeEqual` 抛异常，而那个异常本身就是一个信号
 * （"你猜的长度不对"）；取摘要让两边恒等长，比较时间与内容无关。
 */
function sameToken(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export async function publishProject(
  deps: DesignProjectDeps,
  input: { readonly projectId: string; readonly ownerId: string; readonly scope?: designWorkbench.DesignShareScope },
): Promise<{ readonly project: DesignProjectView }> {
  const current = await deps.projects.get(input.projectId);
  if (current === null) throw new DesignProjectNotFoundError();
  if (current.ownerId !== input.ownerId) throw new DesignProjectNotOwnerError();
  if (!hasDrawnScreen(current)) throw new NothingToPublishError();

  /*
   * 档位：这次没说 ⇒ 沿用已发布那份；从未发布过 ⇒ `prototype`（保守那一档）。
   * 不默认 `full`：`problem` 很可能是从一条内部对话线程导进来的，里面带着立项背景与客户名字。
   */
  const scope = input.scope ?? current.share?.scope ?? "prototype";
  const written = await deps.projects.publishShare(input.projectId, input.ownerId, {
    // ② 首次生成、之后沿用——仓储只在行里没有令牌时写入这个值（见 `publishShare` 头注）。
    token: makeShareToken(deps.orgId, input.projectId),
    scope,
    snapshot: shareSnapshotOf(current),
  });
  if (written === null) throw new DesignProjectNotOwnerError();
  deps.logger?.info("design share published", {
    projectId: input.projectId, scope, traceId: deps.traceId ?? "",
  });
  return { project: await loadProjectView(deps, input.projectId, input.ownerId) };
}

export async function unpublishProject(
  deps: DesignProjectDeps,
  input: { readonly projectId: string; readonly ownerId: string },
): Promise<{ readonly project: DesignProjectView }> {
  const current = await deps.projects.get(input.projectId);
  if (current === null) throw new DesignProjectNotFoundError();
  if (current.ownerId !== input.ownerId) throw new DesignProjectNotOwnerError();
  // 幂等：没发布过也走一遍、也返回 200——要的状态已经达成了，报错只会让重试变成一件要理解的事。
  const written = await deps.projects.unpublishShare(input.projectId, input.ownerId);
  if (written === null) throw new DesignProjectNotOwnerError();
  return { project: await loadProjectView(deps, input.projectId, input.ownerId) };
}

export interface SharedDesignDeps {
  /**
   * 按组织构造的仓储**工厂**——公开读没有 principal，组织是从令牌的 locator 里来的。
   * 这是本束唯一一条这样取 org 的路径，所以它不复用 `DesignProjectDeps`（那个的 `orgId`
   * 来自已鉴权的 principal，形状一样但来源完全不同，混用会让"这个 org 是谁说的"变模糊）。
   */
  readonly projects: DesignProjectRepositoryFactory;
  readonly submitters?: DesignProjectDeps["submitters"];
  readonly logger?: DesignProjectDeps["logger"];
}

export async function getSharedDesign(
  deps: SharedDesignDeps,
  token: string,
): Promise<{ readonly design: designWorkbench.SharedDesign }> {
  const located = parseShareToken(token);
  if (located === null) throw new ShareNotFoundError();
  const [orgId, projectId] = located;
  const row = await deps.projects.forOrg(orgId).get(projectId);
  // 以下每一步失败都是**同一个** `ShareNotFoundError`，见文件头 ③。
  if (row === null || row.share === undefined) throw new ShareNotFoundError();
  if (!sameToken(row.share.token, token)) throw new ShareNotFoundError();

  const snap = row.share.snapshot;
  const names =
    deps.submitters === undefined ? new Map<string, string>() : await deps.submitters.displayNamesForUserIds([row.ownerId]);
  const full = row.share.scope === "full";
  return {
    design: {
      name: snap.name,
      template: snap.template,
      theme: snap.theme,
      accent: snap.accent,
      tokens: snap.tokens ?? designWorkbench.DEFAULT_DESIGN_TOKENS,
      frames: [...snap.frames],
      prototype: [...snap.prototype],
      frameNotes: [...snap.frameNotes],
      frameLinks: snap.frameLinks.map((l) => [...l]),
      publishedAt: row.share.publishedAt,
      ownerName: names.get(row.ownerId) ?? null,
      // `prototype` 档恒为 `null`，不是空串——空串会被渲染成"写了但是空的"。
      problem: full ? snap.problem : null,
      criteria: full ? [...snap.criteria] : null,
    },
  };
}
