---
bundle: identity
phase: "00"
status: confirmed          # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by: "yanbin shen"
confirmed_at: "2026-07-29T07:35:09+08:00"
---

# 契约束 `identity` 设计签核

覆盖 feature：**F01 F02 F03 F15 F16 F17**（33 点）
依据 UC：`uc-0-3 角色本体与两层权限模型`、`uc-0-5 组织配置平面与个人本地组织`

## 四件产出物

| # | 文件 | 内容 |
|---|---|---|
| ① | `domain.md` | 5 个实体/值对象 + **11 条不变量** |
| ② | `usecases.md` | 8 个用例 + **8 种失败模式穷举** + 5 个端口 |
| ③ | `packages/contracts/src/identity.ts` | 8 个操作的 zod 契约（唯一事实源） |
| ④ | `coverage.md` | 23 条 R12 逐条映射，**产出 6 个缺口** |

## 签核前请确认

- [ ] **不变量是真的不变量吗** —— 判据是「任何时刻都为真，违反即数据损坏」，
      且**能写成断言**。写不成断言的是「规则」，应该在 usecases 的前置条件里。
- [ ] **失败模式穷举了吗** —— 界面的异常态全靠它。已有原型是 happy path 演示、零异常态。
- [ ] **coverage 的两个方向都查了吗** —— UC→API（接口够不够）与 API→UC（有没有多余接口）。
- [ ] **6 个缺口的处置认可吗** —— 尤其缺口 1/2（跨束，应提到一致性复核）、
      缺口 3（契约管不到，是部署形态约束）、缺口 5（需你裁决）。

## 确认动作

人类核对后把上面 frontmatter 的 `status` 改为 `confirmed`，填 `confirmed_by` / `confirmed_at`。
⚠ **这是人的动作，不是 agent 的**（同 ADR-003 的 `ui-signoff.md`）。
