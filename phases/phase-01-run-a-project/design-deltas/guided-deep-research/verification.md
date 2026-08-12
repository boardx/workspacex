# 引导式 Deep Research · 可执行验收契约

## UI-first 当前门

```bash
pnpm --filter web exec vitest run tests/ui/guided-research-flow.test.tsx
pnpm --filter web run typecheck
pnpm --filter web run lint:design
```

断言：

- 首页继续/查看分流；
- brief 可编辑并进入 directions；
- directions / outline 都能编辑并新增；
- search 有进度、当前查询与来源；
- report 有正文与至少三条 citation。

## 签核后实现门（文件先命名，缺席是预期 RED）

### Feature A · 首页与会话恢复

```bash
pnpm --filter api exec vitest run tests/research/guided-session-list-and-recovery.test.ts
pnpm --filter web exec vitest run tests/ui/guided-research-home-live.test.tsx
```

### Feature B · brief / directions / outline 三次确认

```bash
pnpm --filter api exec vitest run tests/research/guided-session-human-checkpoints.test.ts
pnpm --filter web exec vitest run tests/ui/guided-research-checkpoints-live.test.tsx
```

### Feature C · Web Search 执行、部分失败与恢复

```bash
pnpm --filter api exec vitest run tests/research/guided-search-progress-and-retry.test.ts
pnpm --filter web exec vitest run tests/ui/guided-research-search-live.test.tsx
```

### Feature D · 完整报告与 citation 完整性

```bash
pnpm --filter api exec vitest run tests/research/guided-report-citations.test.ts
pnpm --filter web exec vitest run tests/ui/guided-research-report-live.test.tsx
```

每个 feature 独立 Issue / 分支 / PR；只有 design delta 经人类确认后才生成进
`feature_list.json` 并进入 sprint。
