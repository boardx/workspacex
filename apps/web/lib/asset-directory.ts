/**
 * F367 —— asset-governance 束里**唯一**有真实 controller 支撑的读路径的类型化薄封装。
 *
 * ## 为什么只有这两个操作，而不是 asset-governance.ts 里的全部 14 个
 *
 * `apps/api/src/interface/controllers/asset-directory.controller.ts` 只落地了
 * `GetAssetDirectory` / `ReadAssetFile` 两个端口（F141）。契约里其余的
 * `listAdminNav` / `getAssetGovernance` / `setAssetGovernance` / `runPreflightChecks` /
 * `publishAsset` / `scanReviewClocks` / `reviewAsset` / `getReviewClock` /
 * `writeAssetFile` / `createAssetFile` / `renameAssetFile` / `deleteAssetFile`
 * 在 `apps/api/src/interface/controllers/` 与 `apps/api/src/application/asset/` 下
 * **没有任何实现**（已用 `grep -rl "listAdminNav\|setAssetGovernance\|publishAsset" apps/api/src`
 * 核实过，零命中）——不是本文件遗漏，是后端确实没有。见 issue #367 的评估结论。
 *
 * ## 数据是真的 HTTP + 真实鉴权，但文件内容仍是 fixture
 *
 * `FixtureAssetFileRepository`（`apps/api/src/infrastructure/asset/fixture-asset-file-repository.ts`）
 * 对**任何** `assetId` 的 `skill`/`agent` 请求都返回同一份写死的目录与正文，不是按
 * `assetId` 查表。这条路径「真」在：走了真实 NestJS 路由、真实 Postgres 组织成员校验
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
