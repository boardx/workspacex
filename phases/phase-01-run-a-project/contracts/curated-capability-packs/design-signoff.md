---
bundle: curated-capability-packs
phase: "01"
covers: [F149]
status: pending
confirmed_by:
confirmed_at:
---

# 契约束 `curated-capability-packs` 设计签核

本束为新的人类签核单元；既有 `skills` 或 Wave 2 的历史签名都不能自动覆盖它。
实现只能在人类完成本束三件签核，并把本束纳入 phase-01 阶段一致性复核之后开始。

## ① UI

材料：[`ui.md`](./ui.md)。

- [ ] 确认无新屏，复用 `/admin/skill` 的手工坐标输入与既有三枚 testid。
- [ ] 确认没有推荐、预选、Garden badge 或隐式导入入口。
- [ ] 确认 UI 材料只通过 control-plane #432 的 `reuse_bundle: skills` 指针复用，不复制截图索引。

## ② 用例

材料：[`usecases.md`](./usecases.md)。

- [ ] 确认成功只发生在管理员显式导入之后，新组织此前恒为 0 Skills。
- [ ] 确认四项均为 advisor-only；脚本/browser/image/TTS/package/fs/network/secret/tool 全部拒绝。
- [ ] 确认 tamper、non-admin、cross-org、idempotency、name conflict 与 unset-root 的失败面完整。
- [ ] 确认不复制上游 scripts/templates，不跟随 `main`。

## ③ API 契约

唯一 API 事实源继续是 `packages/contracts/src/wave2-runtime.ts` 的
`wave2Runtime.operations.importSkillStarterPack`。本束不新增或修改 schema。

- [ ] 确认请求仍只有 `packId`、`packVersion`、`idempotencyKey`。
- [ ] 确认成功体仍是 `SkillStarterImportResult`，失败仍是既有五码。
- [ ] 确认 provenance 进入现有 `manifest` 和不可变 NOTICE/LICENSE 文件，不要求新增 response 字段。
- [ ] 确认本轮不新增 `Skill.source=Garden/community`；如需用户可见来源 badge，另起扩展签核。

## 支撑材料

- [`domain.md`](./domain.md)：12 条机械可断言不变量、四项 pins、安全 allowlist 与跨束边界。
- [`coverage.md`](./coverage.md)：R12 V1–V12 双向映射，无孤儿 API。
- 需求单源：[`garden-skills.md`](../../requirements/25-curated-capability-packs/garden-skills.md)。

## 阶段一致性复核前置

本束新增 phase-01 交叉约束 **XC-31**：

1. 与 `skills` 的 source/status/声明式边界不冲突；
2. 与 Wave 2 显式 import/no-builtin/tenant/idempotency 语义完全复用；
3. 与 `agent-runtime` 的工具能力隔离，不因“Skill”名义引入执行器；
4. 与 `asset-governance` 的社区同步分离，只保留一次性固定 provenance。

人类签本束后，还需由人把 `curated-capability-packs` 加入 `design-coherence.md` 的
`covers_bundles` 并重新核对 XC-31。当前 2026-07-30 的历史 `confirmed_at` 不能作为这次复核证据。

## 确认动作

仅人类可把 frontmatter `status` 改为 `confirmed` 并填写姓名与 ISO 8601 时间；agent 不得代签。
