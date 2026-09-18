# 计算模型 v0.2（人类可读版；可执行实现是 `scripts/compute.cjs`）

> 同一事实只在两处出现：本文解释规则，`compute.cjs` 执行规则。两者若不一致，以
> `compute.cjs` 的数值为准并同步修本文。所有输出都是 **Canvas-derived estimate**。

## 0. Preflight

Canvas 六区（Intent / User / Human-Agent / Workflow / Context / Validation）中，
**Workflow / Context / Validation 任一为空 → 不生成正式 M / γ / μ**，只返回
"需补充的画布信息"（`preflight.ok = false`，`missingRegions`）。

## 1. M_C：递归资产存量（来源：Workflow + Context + Validation）

只识别"能回到下一轮继续使用"的资产（Agent / Workflow / Knowledge / Eval / Pattern）；
一次性交付物不进入 M。每个资产四维打分，每维取 `0 | 0.5 | 1`：

| 维 | 含义 |
|---|---|
| E 明确度 | Canvas 是否明确写出该资产（名称/职责可辨） |
| R 可复用性 | 是否跨任务/跨轮次复用，而非一次性 |
| I 独立调用 | 是否可被独立调用（模块化、有边界） |
| V 可验证性 | 是否有核验/回归手段 |

- 单资产有效值 `value = (E + R + I + V) / 4`
- `M_C = Σ value`（单位：有效递归资产等价单位）。例：识别 8 个资产但成熟度不同 → M_C = 6.1。

## 2. γ_C：递归自反馈指数（来源：Workflow + Validation + Context）

五条闭环，每条 `0 | 0.5 | 1`（0 = 不存在；0.5 = 有意图但回路不清；1 = 明确"写回 + 下一轮调用"）：

| 闭环 | 权重 |
|---|---|
| L1 Validation → Workflow | 0.15 |
| L2 Validation → Context | 0.15 |
| L3 Output → Asset | 0.25 |
| L4 Asset → New Asset | 0.25 |
| L5 Human Feedback → Agent | 0.20 |

- `weighted = Σ w_i · s_i`（0..1），`γ_raw = 1.4 × weighted`
- **封顶规则**：仅当 **L3 = 1 且 L4 = 1** 时允许 `γ_C > 1`；否则 `γ_C = min(γ_raw, 1)`。
  这保证"强递归"结论只由派生闭环证据触发，不因资产数量大或文字写得好而被抬高。
- 三档：`γ_C < 0.2` → 任务 Agent；`0.2 ≤ γ_C ≤ 1` → 普通 MAAU；`γ_C > 1` → 强递归 MAAU。

## 3. μ_C：结构性耗散率（来源：Human/Agent + Context + Workflow + Validation）

五个耗散源，每个 `0..1`（连续；0 = 无风险，1 = 结构性必然回退到人工）：

| 源 | 权重 | 上升的典型证据 |
|---|---|---|
| H 人工依赖 | 0.25 | 核心结论每次都需人工重写 |
| D 数据依赖 | 0.15 | 依赖单一关键数据源 |
| K 知识过期 | 0.20 | 规则/知识无版本、无有效期、无刷新 |
| B 流程脆弱 | 0.20 | 巨大 Prompt / 非模块化 |
| F 反馈薄弱 | 0.20 | 错误只被修正，没有写回 Eval/Rule |

- `μ_C = Σ w · score`；区间：`0–0.25 Low`，`0.25–0.50 Moderate`，`> 0.50 High`
- 报告必须列出 **Top 3 耗散源**（按 `w · score` 降序，同分按字母序）。

## 4. β_C：组织杠杆弹性（辅助量；来源：Human/Agent + Workflow）

三项 `0..1`：`coreStepHumanDependency`（核心步骤人工依赖）、`approvalGateDensity`
（审批闸门密度）、`agentAutonomy`（1 = Agent 只处理异常之外全部自主，0 = 每次都需授权）。

`β_C = 0.85 + 0.25·autonomy + 0.15·(1 − humanDependency) + 0.15·(1 − gateDensity)`，范围 0.85–1.40。
目标区间 1.15–1.30。β 不是独立总分，只在共性参数表作辅助列并参与 Mcrit。

## 5. K_C：Canvas 增长系数（来源：Context + Workflow + Validation）

V0.2 不从静态 Canvas 伪造 λ、ρ、C、H 的"实测值"，压缩为三项结构证据 `0..1`：
`contextSupply`（Context 供给）、`agentWorkflowMaturity`（Agent/Workflow 成熟度）、
`outputToAssetConversion`（Output→Asset 转换效率）。

`K_C = 0.05 + 0.20 × mean(三项)`，范围 0.05–0.25。

## 6. 动力学与 Mcrit

概念方程 `dM/dt = K·M^γ − μ·M`；工程计算 `dM/dt = K_eff·M^γ_C − μ_C·M`，`K_eff = K_C · β_C`。

- **仅 γ_C > 1 时**存在超线性临界点：`Mcrit = (μ_C / K_eff)^(1 / (γ_C − 1))`
- γ_C ≤ 1 → `Mcrit = null`，报告显示"无超线性临界点"，**不得显示"已越过强递归相变阈值"**
- 位置：`|M − Mcrit| / Mcrit < 0.1` → 临界；`M < Mcrit` → 萎缩区；`M > Mcrit` → 超线性增长区
- γ 越接近 1，Mcrit 对 μ/K_eff 比值越敏感（指数 1/(γ−1) 很大），报告页脚固定提示。

## 7. 退化压力测试（固定假设，与 Canvas 无关）

假设：把所有关键步骤改成"全量人工审批"。变换：

- friction：`approvalGateDensity = 1`，`coreStepHumanDependency = 1`，`agentAutonomy = 0`
- loops：`L1 / L2 / L5` 减半；`L3 / L4 = min(score, 0.5)`（派生链被人工重写打断）
- dissipation：`H = max(H, 0.8)`，`F = max(F, 0.6)`，其余不变
- growth：`outputToAssetConversion` 减半

然后用同一套公式重算 γ / β / μ / K / Mcrit，与当前值并列，解释"为什么退化"。

## 8. 目标结构（固定行）

γ > 1.0；β 1.15–1.30；μ < 0.20；闭环保护方式：隔离边界 / 写回 / 版本化 / 抽检。

## 9. 工程验收底线

1. 所有 M / γ / μ / β 都能回溯到 Canvas 原文证据与规则（输入里每个分值都带 `evidence.quote`）。
2. 相同结构化输入必须得到相同确定性数值（`computeDiagnosis` 是纯函数）。
3. γ ≤ 1 时不得显示"已越过强递归相变阈值"。
4. 最终 PDF 固定 5 页，图文比例优先。
5. 所有示意 / 估算值标记 Canvas-derived，不冒充生产实测。
