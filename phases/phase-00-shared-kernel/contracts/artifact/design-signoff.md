---
bundle: artifact
phase: "00"
covers: [F04, F05, F06, F07, F08]   # 束↔feature 映射的权威（ADR-023 决策三）；改它等于改评审范围
status: confirmed          # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by: "yanbin shen"
confirmed_at: "2026-07-29T07:35:09+08:00"
---

# 契约束 `artifact` 设计签核

覆盖 feature：**F04 F05 F06 F07 F08**（21 点）
依据 UC：`uc-0-1 把 Studio 产出保存回项目`

## 四件产出物

| # | 文件 | 内容 |
|---|---|---|
| ① | `domain.md` | 8 个实体/值对象 + **14 条不变量**（其中 I-13/I-14 **跨束**） |
| ② | `usecases.md` | 9 个用例 + **12 种失败模式穷举** + 7 个端口 |
| ③ | `packages/contracts/src/artifact.ts` | 9 个操作的 zod 契约（唯一事实源），mock 已生成于 `apps/web/lib/generated/artifact.mock.ts` |
| ④ | `coverage.md` | 8 条 R12 + F04 结构性验收逐条映射，**产出 8 个缺口** |

## 签核前请确认

- [ ] **不变量是真的不变量吗** —— 判据「任何时刻都为真，违反即数据损坏」且**能写成断言**。
      特别看 I-2（对象写一次）与 I-4（灾备三源）——它们是**部署形态约束**，契约管不到，
      须确认有人负责（缺口⑤）。
- [ ] **失败模式穷举了吗** —— 12 种。尤其 `ARTIFACT_NOT_FOUND` 兼任草稿越权（404 非 403，V4）、
      `REQUIRES_PINNED` 带一键定版入口（E1/F07）、`MATERIALIZATION_FAILED` 不得静默（E3）。
- [ ] **coverage 的两个方向都查了吗** —— 9 个操作无孤儿；8 条 R12 有 3 条落在缺口。
- [ ] **8 个缺口的处置认可吗** —— 尤其缺口 1/2/3（跨束，应提一致性复核）、
      缺口 5（契约管不到，部署形态）、缺口 6（快照不可删 vs 合规撤回删除边界，需你确认）、
      缺口 8（[待确认] UML 第13节缺失，确认 D-38 覆盖本束）。

## 跨束不变量（须阶段一致性复核，不能本束单独实现）

- **I-13** Artifact 的 `scope` 沿数据链路传播到 Segment/embedding/图节点/缓存/Context Pack
  （UC-0.3 R7）——跨 artifact + identity + context-pack，与 identity 束缺口②同源。
- **I-14** 下游引用只能指向 `pinned` 版本（AC1）——跨 context-pack/13-deliv/10-report/09-kg/14-brain。

## 确认动作

人类核对后把上面 frontmatter 的 `status` 改为 `confirmed`，填 `confirmed_by` / `confirmed_at`。
⚠ **这是人的动作，不是 agent 的**（同 ADR-003 的 `ui-signoff.md`）。
