---
bundle: web-kernel
phase: "00"
status: pending          # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by: ""
confirmed_at: ""
---

# 契约束 `web-kernel` 设计签核

覆盖 feature：**F14**（13 点，phase-00 唯一代码已落地的 feature）
依据 UC：`uc-0-4 前端内核与设计单源`

## 四件产出物

| # | 文件 | 内容 |
|---|---|---|
| ① | `domain.md` | 6 个前端内核值对象 + **11 条不变量**（每条都已有一道在跑的门控） |
| ② | `usecases.md` | 7 道门控面（契约的可执行形式）+ 3 个渲染面契约 + 失败模式穷举 |
| ③ | **不产 zod 契约文件** | 见 domain.md 第三节：本束零后端/零 mock，zod 会制造第六次漂移。**③ 件 = 既有 7 道门控脚本本身** |
| ④ | `coverage.md` | V1–V10 逐条映射到门控命令，**产出 7 个缺口** |

## 与另外三束的关键差异（签核前先接受这个前提）

`identity` / `artifact` / `context-pack` 的第 ③ 件是 `packages/contracts/src/*.ts` 的 zod 契约。
**本束没有后端**——它是前端内核。它的契约是**设计 token / 字号档位 / 七态 / testid 命名 /
预览开关不可达**，这些的单一事实源分别是 `globals.css` / `lib/font-scale.ts` / `lib/ui-state.ts` /
`lint-design.sh` 正则 / `verify-prod-gates.sh`——**都不是也不该是 zod**。
再造一个 `web-kernel.ts` 只会制造第二份声明（bash 门控 / CSS / tailwind 无法 import zod）。

## 签核前请确认

- [ ] **接受「本束不产 zod」的判断吗** —— 见 domain.md 第三节的四条理由。若不接受，请指出
      哪个下游消费者（后端 DTO / 前端类型 / OpenAPI / mock）在本束里真实存在。
- [ ] **11 条不变量都能写成断言吗** —— 本束的「不变量」判据放宽为「违反即设计漂移 /
      安全错觉 / 异常态缺失」，但每条仍是机械可断言的，且右列都指了一道在跑的门控。
- [ ] **失败模式穷举了吗** —— 本束的「失败」= 门控在什么输入下必须 exit 1（R12 V5：
      只验脚本能跑不验能抓到违规 = 没有门控）。
- [ ] **7 个缺口的处置认可吗**，尤其：
      - **G-2（V9 响应式）是唯一真产品缺口** —— F14 已落地，但 375/768/1280 无横向溢出
        **只被人肉验过一次，无机器覆盖**。UC-0.4 R8 承诺「V1–V10 无一依赖人工判断」，
        V9 是这个承诺唯一未兑现的一条。请裁决是否在 F14 收口前补 Playwright。
      - **G-1 / G-3（第二份副本）** —— 七态保留名映射、token 豁免清单各已声明在两处，
        是本项目最高发的漂移形态。收敛方向是纯 TS 常量单源 + bash sed 读取，**不是 zod**。
      - **G-5 / G-6 / G-7（门控自身/正向存在性/元覆盖未验）** —— 对照 V5 已把「门控有效」
        钉成断言，V3/V7/V10 的对应断言尚缺。

## 确认动作

人类核对后把上面 frontmatter 的 `status` 改为 `confirmed`，填 `confirmed_by` / `confirmed_at`。
⚠ **这是人的动作，不是 agent 的**（同 ADR-003 的 `ui-signoff.md`）。

> 附：本束的自检命令（人类可复跑验证四件套所述门控全绿）：
> ```
> cd apps/web && pnpm typecheck && ./scripts/lint-design.sh && \
>   node scripts/check-token-contrast.mjs && pnpm vitest run
> cd ../.. && node .harness/scripts/lint-contract-source.mjs
> ```
