# 验证证据（#1381）

实测 SHA：本分支 HEAD（基线 `cc23c596`）。以下命令均已在隔离测试库上跑绿，非声明。

## 后端

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  pnpm --filter api exec vitest run tests/capability/model
```
→ 20 files / 233 tests passed，含新增：
- `tests/capability/model/list-model-pool-e2e.test.ts`（4 例：空池 / 接入后可读且字段一致 /
  凭据不在响应里 / 非管理员 403）——打真实 PostgreSQL，`createApp()` 起真实 Nest 进程。
- `tests/capability/model/seed-local-models.test.ts`（3 例：qwen3.5-4B 种子落库、判重）。
- `registry-fields.test.ts` 的 `POOL_LISTING_GAP` 从五个字段收敛为 `[]`（`FIELDS_NO_RESPONSE_RETURNS`
  是从 `responseSchemas()` 派生的计算值，不是手改的常量——契约一加操作它自动收敛）。
- `credential-never-echoed.test.ts` 新增 `credentialConfigured` 的显式豁免+反证（同
  `endpointHint` 的既有豁免纪律：按名字豁免，且断言它的**形状**——bare boolean，塞一个
  真凭据字符串进去必须 `safeParse` 失败）。

```bash
node apps/api/scripts/lint-permission-paths.mjs
```
→ `✅ every tenant-table read goes through the guarded read path`（`pg-model-pool-repository.ts`
的既有豁免仍然成立：`GET /models` 复用同一个 `requireOrgAdmin` 门，未新增租户表访问）。

```bash
pnpm --filter api exec tsc --noEmit -p .
```
→ 除 `packages/fabric-markdown`（已知 baseline 缺陷，dist 未构建导致的幽灵 DOM 类型错误，
与本改动无关）外零错误。

## 前端

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  pnpm --filter web exec vitest run tests/ui/admin-model-view-toggle.test.tsx \
    tests/session/agent-admin-route-no-mock.test.ts
```
→ 2 files / 9 tests passed。`admin-model-view-toggle.test.tsx` 重写为 mock `listModels()`
（不再依赖 `lib/mock/admin.ts` 的静态清单），断言卡片/列表切换、字段完整性、开关交互均
成立。`agent-admin-route-no-mock.test.ts` 的反证锚点从 `model-screen.tsx` 换成
`mcp-screen.tsx`（前者不再有任何 `lib/mock` 边，作为「扫描器能抓到 mock 边」的反证不再
成立，换一个仍纯 mock 的屏）。

```bash
node apps/web/scripts/lint-no-backend-badge.mjs
```
→ `model-screen.tsx` 从「零后端·已标注」变为「非纯 mock」（因为它现在真的 import 了
`@/lib/live-model` 的 `listModels`），门控本身不再要求它渲染 `<NoBackendNotice />`——
页面改用一条如实描述混合态的 `ModelScreenNotice`（列表/接入真实，启用/停用/测试判读仍
本地演示）。

```bash
pnpm --filter web exec tsc --noEmit -p .
```
→ 零错误。

## 反证纪律（对照 `workspacex-gate-counterproof-discipline`）

- `list-model-pool-e2e.test.ts` ① 空池组织显式钉住 `[]`（不是「没测所以看起来是空」）；
  ③ 用「响应体不包含明文/密文/`credential`/`endpoint` 字面量」而非仅字段名断言，
  且 `register-model-e2e.test.ts` 已有的同类反证（植入凭据后断言必须变红）仍然覆盖
  同一条写路径。
- `registry-fields.test.ts` 新增两条断言都基于**契约的运行时内省**
  （`schemaKeyNames`/`responseSchemas()`），不是复述字段名字面量——契约漂移会让断言真的红。
