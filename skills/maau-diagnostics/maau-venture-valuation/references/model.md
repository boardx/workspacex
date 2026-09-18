# 计算模型 V0.5（人类可读版；可执行实现是 `scripts/calc.cjs`，版本号见其 CALCULATION_VERSION）

> 同一事实只在两处出现：本文解释规则，`calc.cjs` 执行规则。不一致时以 `calc.cjs` 为准并同步修本文。
> LLM 只做语义抽取 / 分类 / Comparable 解释；所有数字由 Calculator 生成（Requirement V0.5 §13.2）。

## 0. Preflight（§2.1）
Workflow / Context / Validation 任一为空 → `preflight.ok=false`，只出结构缺口报告，不出金额。
没有任何 observed 证据 → V_now = V_seed（EI_observed = 0），只输出 Seed Benchmark + Forecast。

## 1. 内部发动机（§3）：dM/dt = λρ · C^α · H^β · M^γ − μM
- **M**：Σ 资产有效值，单资产 = (E+R+I+V)/4，每维 ∈ {0, 0.5, 1}。N = 资产数，maturity = M/N。
- **γ**：五条闭环加权 L1 .15 / L2 .15 / L3 .25 / L4 .25 / L5 .20，`γ_raw = 1.4 × Σ w·s`；仅当 L3 = 1 且 L4 = 1 才允许 γ > 1，否则封顶 1。
  三档：γ < 0.2 Task Agent；0.2 ≤ γ ≤ 1 普通 MAAU；γ > 1 强递归 MAAU。
- **μ**：H .25 / D .15 / K .20 / B .20 / F .20 加权，Low ≤ 0.25 < Moderate ≤ 0.5 < High。
- **λ ρ C H** ∈ [0,1] 直接来自画布证据；**Λ = λρ·C^α·H^β**，α = β = 1（版本化）。
- 增长项 Λ·M^γ，耗散项 μ·M；`growthCoversDecay` = 增长项 > 耗散项。
- **Mcrit** 只在 γ > 1 时成立：(μ/Λ)^(1/(γ−1))；位置 below / near（±10%）/ above。
- 纪律：M 大 ≠ 飞轮强；分界是 γ 是否显著大于 0，以及增长项能否覆盖 μM。

## 2. Evidence Ledger（§2.2 / §5）
| type | 进 V_now | 进 Forecast | 用途 |
|---|---|---|---|
| observed | 是 | 是 | EI_observed |
| target | 否 | 作为里程碑 / 成功门槛 | 门槛 |
| planned | 否 | 是（EI × P） | 预测 |
| assumption | 否 | 作为风险 | 风险 |

默认 EI：E1 .10 · E2 .20 · E3 .35 · E4 .40 · E5 .50 · E6 .65（E2/E4 为 V0.5 插值规则；配置化并带 calculation_version）。
**同一等级只计一次**（第二条同级 observed 标 duplicate，EI 记 0），避免同级重复复利。
`EI_observed = Σ observed.ei`；`EI_future(h) = Σ planned(horizon ≤ h).ei × P_i × 情景系数`，12m 包含 90d 的里程碑。
P_i 默认 = P_execution；画布明确给出概率时用画布值（`probabilitySource`）。

## 3. Benchmark Anchor（§6）
Comparable 只用于设置 V_seed 与现实校验，绝不反向修改 M / γ / μ。
- 可用 = `valueUsd` 存在 ∧ evidenceGrade ∈ {A, B, C}；D 级与 Not publicly disclosed 不进金额。
- 可用样本 ≥ 2：V_seed = [min, median, max]（偶数个取中间两数的几何均值）。不用单一 Comparable 决定 V_seed。
- 否则 Value Index：V_seed = 100，V_index = 100·e^EI_observed（§7.1），不硬造美元。
- 每条 Comparable 带 source / sourceDate / evidenceGrade；benchmark_date 与 source_count 进披露。

## 4. 当前价值与预测（§7–§9）
- V_now = V_seed × e^(EI_observed)，三点区间一起复利。
- P_execution = clamp(0.40 + 0.20·Maturity + 0.25·G + 0.15·D, 0.25, 0.95)，G = min(γ,1.5)/1.5，D = 1 − μ（BoardX Forecast Heuristic v0.1，产品启发式）。
- 情景：Conservative 0.60×P；Base 1.00×P；Upside min(1.25×P, 1)。
- V_90d / V_12m = V_now × e^(EI_future)。Upside 不是"最可能结果"。

## 5. 四象限（§12.1）与置信度（§14.2）
- M 高 ⇔ M ≥ 5；EI 高 ⇔ EI_observed ≥ 0.35（付费级）。① 忙碌但没学习 ② 项目公司风险 ③ 技术自嗨风险 ④ 递归增长状态。
- High：observed 覆盖付费/持续使用（≥E3）∧ 可用 Comparable ≥ 3 ∧ Canvas 完整；Medium：有问题/使用证据 ∧ 可用 Comparable ≥ 2；否则 Low。

## 6. 披露（§15.2）
valuation_model_version / calculation_version / benchmark_date / source_count / value_mode；每个参数标 Canvas-derived / Benchmark-derived / heuristic；
敏感性 = 前 3 个里程碑各自失败时 12m Base 的回撤。

## 7. 验收（§16）对应
无 Validation → Preflight 拒绝；只有 Target → EI_observed 0；首个付费 observed → E3 进 EI；续费只是计划 → 只进 Forecast；
Benchmark 无公开估值 → Not publicly disclosed + Value Index；M 高 EI 低 → ③；EI 高 M 低 → ②；同一输入 → 逐字节相同（verify.ts 断言）。
