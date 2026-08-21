# `viewer-role` — feature ↔ 需求映射

| feature | 需求出处 | 覆盖情况 |
|---|---|---|
| F01 | `requirements/01-viewer-role.md#R2` | 视角切换器结构、状态后缀——UI 骨架已建 |
| F02 | `requirements/01-viewer-role.md#R1` | 服务端角色矩阵——待 API 契约文件落地后实现 |

## R12 门控映射（第 ③ 件形态 A：`packages/contracts/src/viewer-role.ts`）

| R12 | 一句话 | 门控命令（API 操作） | 后端落点 | 状态 |
|---|---|---|---|---|
| V1 | facilitator 拿到『主持台·全场』+全部分组，groupLead/member 只拿到自己那组，observer 只拿『主持台·全场』一项 | `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/live-collab/get-viewer-options.test.ts` | `apps/api/src/application/live-collab/get-viewer-options.ts` `getViewerOptionsUseCase` | ✅ |
| V2 | `requestedViewerId` 越权（组员传 stage、任意角色传别组 id、observer 传任意 groupId）服务端拒绝 `VIEWER_SCOPE_DENIED`（403） | 同上（同一测试文件覆盖越权分支） | `packages/contracts/src/viewer-role.ts` err 枚举 + 同一 use case | ✅ |
| V3 | 返回体不含任何分组原始字段（`leaderUserId`/`memberUserIds`/`scenario`）泄露给无权限角色 | 同上 | `apps/api/src/application/live-collab/get-viewer-options.ts` `toViewerOptions` | ✅ |
| V4 | 前端 `tab-live.tsx` 优先读服务端 `viewerOptions`，未到手前回退本地 `computeViewerOptions`（非安全边界） | `pnpm --filter web exec vitest run tests/ui/project-live-viewer-switcher.test.tsx` | `apps/web/components/project/tab-live.tsx` | ✅ |

## 反向检查

- `requirements/01-viewer-role.md` 全文两节（R1/R2）均已被 F01/F02 覆盖，无遗漏章节。
- `ui.md` 列出的 2 个截图缺口（G-1/G-2）尚未对应到任何 feature 的 verification——
  是否需要新增一个 feature 补这两张图，还是靠 code review 口头确认，签核时请一并定。
