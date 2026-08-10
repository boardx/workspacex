/**
 * F367 —— asset-governance 束里**唯一**有真实 controller 支撑的读路径的类型化薄封装。
 *
 * ## 为什么只有这两个操作，而不是 asset-governance.ts 里的全部 14 个
 *
 * `apps/api/src/interface/controllers/asset-directory.controller.ts` 现在落地了**五个**端口：
 * `GetAssetDirectory` / `ReadAssetFile`（F141 起就有）与
 * `WriteAssetFile` / `DeleteAssetFile` / `RenameAssetFile`。
 *
 * ⚠ **本段在 #881 之前是过期的**：它当时写着「`writeAssetFile` 等在后端没有任何实现」，
 * 那句话在 F141 时为真，但 **#785 之后不再为真**（`@Put("/assets/:assetKind/:assetId/files/content")`
 * 就在上述 controller 里）。过期的头注比没有头注更坏——它让「界面没接」看起来像
 * 「后端没有」，于是没人去接。这正是 #881 要修的三处之一。
 *
 * 契约里仍**没有** controller 的是：`listAdminNav` / `getAssetGovernance` /
 * `setAssetGovernance` / `runPreflightChecks` / `publishAsset` / `scanReviewClocks` /
 * `reviewAsset` / `getReviewClock` / `createAssetFile`（2026-08-11 复核）。
 *
 * ## 数据是真的 HTTP + 真实鉴权，但文件内容仍是 fixture
 *
 * ⚠ 这一段同样**在 #785 之后只对一半成立**：`kernel.module.ts` 现在注入的是
 * `PgAssetFileRepository(db, new FixtureAssetFileRepository())` —— **`skill` 走真实
 * Postgres**（`skills`/`skill_versions`/`skill_version_files`，模型 A），
 * 只有 `agent` 等其余 kind 仍回退到 fixture（见 #787）。
 * 原文（对 `agent` 仍然成立）：`FixtureAssetFileRepository`
 * 对**任何** `assetId` 的请求都返回同一份写死的目录与正文，不是按 `assetId` 查表。这条路径「真」在：走了真实 NestJS 路由、真实 Postgres 组织成员校验
 * （`findOrgMembership`），**不真**在：文件字节不是从对象存储/数据库读出来的。
 * 这个界限对调用方必须可见，所以不在这里假装它是全量真实数据。
 *
 * ## 鉴权：复用 F122 的 Bearer token 约定
 *
 * 本仓唯一的真实登录入口仍是 `/project/live` 内嵌的登录表单（`apps/web/lib/live-projects.ts`
 * 的 `login`）。`/asset-governance` 页面本身没有登录 UI——本文件只在
 * `localStorage` 已经有 F122 登录写入的 token 时才去打真实接口；没有 token 时
 * 调用方应当继续展示 mock（见 `ag-screens.tsx` 的 `Editor` 组件）。
 */
import { assetGovernance } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type AssetKind = z.infer<typeof assetGovernance.AssetKind>;
export type AssetDirectory = z.infer<typeof assetGovernance.operations.getAssetDirectory.out>;
export type AssetFileContent = z.infer<typeof assetGovernance.operations.readAssetFile.out>;

function fillPath(template: string, params: Record<string, string>): string {
  let path = template;
  for (const [k, v] of Object.entries(params)) {
    path = path.replace(`:${k}`, encodeURIComponent(v));
  }
  return path;
}

export async function getAssetDirectory(assetKind: AssetKind, assetId: string): Promise<AssetDirectory> {
  return apiRequest<AssetDirectory>(
    fillPath(assetGovernance.operations.getAssetDirectory.path, { assetKind, assetId }),
  );
}

export async function readAssetFile(
  assetKind: AssetKind,
  assetId: string,
  path: string,
): Promise<AssetFileContent> {
  return apiRequest<AssetFileContent>(
    fillPath(assetGovernance.operations.readAssetFile.path, { assetKind, assetId }),
    { query: { path } },
  );
}

/**
 * #881：写回一个已存在的文件。**这是"编辑"真正落库的那一步。**
 *
 * ⚠ 语义是「**追加一个新版本**」，不是「原地改这一版」：`skill_versions` /
 * `skill_version_files` 对 app_rw 只 GRANT SELECT/INSERT（DB 触发器拒绝 UPDATE/DELETE），
 * 服务端 `PgAssetFileRepository.writeFile` 因此走的是 `publishNewSnapshot`。
 * 界面必须照这个事实说话——说成「已修改」会让人以为历史被改写了。
 *
 * ⚠ 这个端口**不创建新路径**（`existing === undefined` ⇒ 返回 null ⇒ 服务端 404）。
 * 新建文件是 `createAssetFile`，而它**至今没有 controller**，所以本文件不封装它——
 * 封装一个注定失败的入口，等于在界面上摆一个骗人的按钮（同 `live-skill.ts` 头注那条纪律）。
 */
export type WriteAssetFileOut = z.infer<typeof assetGovernance.operations.writeAssetFile.out>;

export async function writeAssetFile(
  assetKind: AssetKind,
  assetId: string,
  path: string,
  body: string,
): Promise<WriteAssetFileOut> {
  // ⚠ 不吞失败：`ApiError` 原样抛给调用方，由界面显示真实 reasonCode。
  return apiRequest<WriteAssetFileOut>(
    fillPath(assetGovernance.operations.writeAssetFile.path, { assetKind, assetId }),
    { method: "PUT", body: { assetKind, assetId, path, body } },
  );
}
