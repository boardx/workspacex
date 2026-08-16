# canvas 模板承载 mermaid 图模板 · 可执行验收契约

> 本文件写的是**验收标准**，不是已跑通的证据——三节草案（#496 补签 / mermaid 类型扩展 /
> 两个次级缺口）此刻都停在设计稿，`packages/contracts/src/canvas.ts` 未被本次任务改动。
> 下面每个命令对应的测试文件**目前大概率不存在**，这是预期的 RED——它们要在人类签核后、
> 对应 feature 开工实现时才被创建。

## 第①件：#496 补签——签核后要跑的确认命令（补签本身不需要新代码）

补签不改代码，只改 `design-signoff.md` 的 `status`。签核落地后，用以下既有命令确认
「补签没有让任何东西变红」：

```bash
pnpm --filter api exec vitest run tests/canvas/template-lifecycle-http.test.ts
node .harness/scripts/lint-contract-source.mjs
pnpm exec tsx .harness/scripts/verify-uc-coverage.ts phase-01
```

断言（已有事实，签核只是确认它们继续为真）：

- `createTemplate` 真栈跑通：HTTP → controller → application → `PgCanvasTemplateRepository`
  → PostgreSQL，用 `asApp` 重读而非信任响应体回显。
- 契约单源门控不因 `createTemplate` 已实现而报「后端手写第二份类型」。

## 第②件：mermaid 图模板类型扩展——落地后的验收线

### `MermaidDiagramType` 枚举与上游 `DiagramKind` 集合相等

```bash
pnpm --filter api exec vitest run tests/canvas/mermaid-diagram-type-contract-source.test.ts
```

断言（仿 `template-registry-19-key-displayname.test.ts` 的既有做法，逐值点名差集，
不用 `toHaveLength`）：

- `MermaidDiagramType` 的枚举值集合 == `@repo/fabric-markdown` 的 `DiagramKind` 集合
  去掉 `template` / `usecase`（若人类裁决排除 `xychart`，则也去掉它）。
- 契约层新增一个成员而上游没有 ⇒ 红；上游新增一个成员而契约没跟 ⇒ 红（双向差集）。

### `underlyingType` 判别联合校验

```bash
pnpm --filter api exec vitest run tests/canvas/create-template-mermaid-branch.test.ts
```

断言：

- `underlyingType: "canvas-section"` 分支要求 `sections` 存在、`diagramSkeleton` 不存在
  （多余字段应被 `.strict()` 拒绝，否则判别联合形同虚设）。
- `underlyingType` 取 `MermaidDiagramType` 任一值时，要求 `diagramSkeleton` 存在且
  `diagramSkeleton.kind === underlyingType`（一致性校验，见 contract.md 四节「创建
  mermaid 图模板」用例的失败模式行）。
- 既有 19 个内置模板与既有组织自建模板（`underlyingType` 历史自由字符串值）在契约收窄后
  **仍可读**——这是一条向后兼容回归断言：种一行历史自由字符串的 `underlyingType`，
  确认 `listTemplates` 的 `out` 校验不因收窄而拒绝旧数据（若历史数据无法归入
  `"canvas-section"`，本条断言本身就是发现「收窄不可行」的机械信号，届时契约需要改为
  接受第三个「legacy」判别分支而不是强行归类）。

### 响应体契约校验（B-8 规则，覆盖拒绝路径）

```bash
pnpm --filter api exec vitest run tests/canvas/contract-response.test.ts
```

断言：`createTemplate.out` 与 `mintTemplateVersion.out` 的 `safeParse` 逐条通过；并有一组
反向断言证明这些 schema 确实会拒绝漂移的 body（缺 `diagramSkeleton.kind` 时应被拒）。

### fabric-markdown 装载路径不受影响

```bash
pnpm --filter @repo/fabric-markdown exec vitest run
pnpm --filter api exec vitest run tests/canvas
```

断言：vendor 的 222 个上游单测保持全绿（VENDOR.md 回流规程第 4 步既有要求）；本仓
`tests/canvas` 目录下既有 key/displayName 契约测试不因本 delta 落地而回归。

## 第③件：两个次级缺口——落地后的验收线

### `ownerTeamId` fail-closed（C_CANVAS_8①）

```bash
pnpm --filter api exec vitest run tests/canvas/create-template-team-only-owner.test.ts
```

断言：

- `visibility: "team-only"` 且未传 `ownerTeamId` ⇒ 400（若人类签核选择的是「显式拒绝」
  颗粒度）；契约层 `.refine` 的 `message` 与 `path: ["ownerTeamId"]` 与
  `identity.ts` 的 `CapabilityAddPayload` 同型断言方式一致。
- `visibility: "team-only"` 且 `ownerTeamId` 指向调用者所在团队 ⇒ 成功，新建行对该团队
  成员可见、对团队外成员不可见（读路径回归，复用既有 RLS 断言模式）。
- 若人类签核选择维持「静默 fail-closed」颗粒度（不新增拒绝），则本文件对应断言改为：
  未传 `ownerTeamId` 时创建成功，但该行仅创建者自己可见——与今天 `create-template.ts`
  的既有行为一致，此时不新增 `TEAM_REQUIRED_FOR_TEAM_ONLY` 错误码，本条测试改为反向
  断言「该错误码不存在于 `CanvasError` 闭集」，避免不可达错误码。

### 「基于既有模板开新版」（C_CANVAS_8②）

```bash
pnpm --filter api exec vitest run tests/canvas/mint-template-version-http.test.ts
```

断言（真栈，同 `template-lifecycle-http.test.ts` 的既有标准——HTTP → controller →
application → repository → PostgreSQL，`asApp` 重读）：

- 对已发布模板调用 `mintTemplateVersion`，产出 `version = 当前最大 version + 1` 的新
  `draft` 行，`key` 与原模板一致。
- 对不存在的 `key` 调用 ⇒ `TEMPLATE_NOT_FOUND`。
- 新版本行走完整的 `publishTemplate` / `trialTemplate` 生命周期不受影响（回归既有
  四操作）。
- 若签核确认「不去重、每次点击都新建一行」的默认语义，加一条并发断言：两个并发请求
  各自成功、产出两个不同的 version 号，不发生 version 冲突（唯一约束或行锁生效）。

### 前端

```bash
pnpm --filter web exec vitest run tests/ui/canvas-template-mermaid-branch.test.tsx
pnpm --filter web run typecheck
pnpm --filter web run lint:design
```

断言：

- `CreateDialog` 的分岔控件（画布分区 / mermaid 图模板）切换时正确隐藏/展示对应字段组。
- 选中 mermaid 分支时，图类型下拉的选项集合与契约 `MermaidDiagramType` 的枚举值集合
  一致（前端不得手写第二份枚举——契约单源规则同样适用于 `<select>` 的 `options`）。
- 「基于此开新版」按钮仅在 `status !== "draft"` 的行上出现，点击后预填的字段与选中行
  一致。

## 门控汇总（签核后实现 feature 时逐条跑）

```bash
node .harness/scripts/lint-arch-deps.mjs
node .harness/scripts/lint-contract-source.mjs
pnpm exec tsx .harness/scripts/verify-uc-coverage.ts phase-01
pnpm --filter api run typecheck
pnpm --filter web run typecheck
```

每个 feature 独立 Issue / 分支 / PR；只有本 design delta 经人类确认后才生成进
`feature_list.json` 并进入 sprint（沿用 `guided-deep-research/verification.md` 的既有
收尾方式）。
