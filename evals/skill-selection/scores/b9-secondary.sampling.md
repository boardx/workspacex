# b9 次要来源包抽样说明

- 评审日期：2026-09-24；随机种子：20260924（Python `random.Random(20260924)`，按包独立实例化）
- id 规则：包短名 + "/" + SKILL.md 所在目录的仓库相对路径，去掉恰为 `skills`、`plugins` 的路径段
- 抽样脚本：scratchpad/b9/sample.py；输出：`b9-secondary.jsonl`（96 行）

## alir（alirezarezvani/claude-skills）

- 总数 N = 200，抽样 n = 40
- 抽样方式：按顶层目录分层、最大余数法按比例分配 40 个（每层至少 1），6 个指定 skill 先计入所属层（c-level-advisor 4 个、commercial 2 个），层内其余名额 random.Random(20260924).sample。范围：marketing-skill(49)、marketing(7)、c-level-advisor(40)、c-level-agents(22)、commercial(8)、business-operations(7)、finance(5)、product-team(17)、business-growth(5)、project-management(9)、ra-qm-team(17)、compliance-os(9)、research-ops(5)；忽略 .gemini/.codex 镜像及 engineering*/productivity/research/agent-launcher/markdown-html/loop-library。去除 8 个与 `<dir>/skills/<name>` 字节相同的嵌套插件副本（c-level-advisor 下 6 个、ra-qm-team 下 2 个），保留扁平路径。各层分配：c-level-advisor 8、marketing-skill 10、c-level-agents 5、product-team 3、ra-qm-team 3、commercial 2、compliance-os 2、project-management 2，其余各 1。
- 抽中 id：
  - `alir/business-growth/business-growth-skills` ← `business-growth/skills/business-growth-skills/SKILL.md`
  - `alir/business-operations/vendor-management` ← `business-operations/skills/vendor-management/SKILL.md`
  - `alir/c-level-advisor/board-meeting` ← `c-level-advisor/skills/board-meeting/SKILL.md`
  - `alir/c-level-advisor/context-engine` ← `c-level-advisor/skills/context-engine/SKILL.md`
  - `alir/c-level-advisor/decision-logger` ← `c-level-advisor/skills/decision-logger/SKILL.md`
  - `alir/c-level-advisor/cfo-advisor` ← `c-level-advisor/skills/cfo-advisor/SKILL.md`
  - `alir/c-level-advisor/strategic-alignment` ← `c-level-advisor/skills/strategic-alignment/SKILL.md`
  - `alir/c-level-advisor/c-level-skills` ← `c-level-advisor/skills/c-level-skills/SKILL.md`
  - `alir/c-level-advisor/vpe-advisor` ← `c-level-advisor/skills/vpe-advisor/SKILL.md`
  - `alir/c-level-advisor/executive-mentor/hard-call` ← `c-level-advisor/executive-mentor/skills/hard-call/SKILL.md`
  - `alir/c-level-agents/decide` ← `c-level-agents/skills/decide/SKILL.md`
  - `alir/c-level-agents/cmo-review` ← `c-level-agents/skills/cmo-review/SKILL.md`
  - `alir/c-level-agents/cross-eval` ← `c-level-agents/skills/cross-eval/SKILL.md`
  - `alir/c-level-agents/post-mortem` ← `c-level-agents/skills/post-mortem/SKILL.md`
  - `alir/c-level-agents/execute` ← `c-level-agents/skills/execute/SKILL.md`
  - `alir/commercial/deal-desk` ← `commercial/skills/deal-desk/SKILL.md`
  - `alir/commercial/pricing-strategist` ← `commercial/skills/pricing-strategist/SKILL.md`
  - `alir/compliance-os/soc2-audit-prep` ← `compliance-os/skills/soc2-audit-prep/SKILL.md`
  - `alir/compliance-os/gdpr-audit-prep` ← `compliance-os/skills/gdpr-audit-prep/SKILL.md`
  - `alir/finance/financial-analyst` ← `finance/skills/financial-analyst/SKILL.md`
  - `alir/marketing-skill/marketing-strategy-pmm` ← `marketing-skill/skills/marketing-strategy-pmm/SKILL.md`
  - `alir/marketing-skill/pricing-strategy` ← `marketing-skill/skills/pricing-strategy/SKILL.md`
  - `alir/marketing-skill/copy-editing` ← `marketing-skill/skills/copy-editing/SKILL.md`
  - `alir/marketing-skill/analytics-tracking` ← `marketing-skill/skills/analytics-tracking/SKILL.md`
  - `alir/marketing-skill/copywriting` ← `marketing-skill/skills/copywriting/SKILL.md`
  - `alir/marketing-skill/content-production` ← `marketing-skill/skills/content-production/SKILL.md`
  - `alir/marketing-skill/email-sequence` ← `marketing-skill/skills/email-sequence/SKILL.md`
  - `alir/marketing-skill/aeo` ← `marketing-skill/skills/aeo/SKILL.md`
  - `alir/marketing-skill/brand-guidelines` ← `marketing-skill/skills/brand-guidelines/SKILL.md`
  - `alir/marketing-skill/referral-program` ← `marketing-skill/skills/referral-program/SKILL.md`
  - `alir/marketing/linkedin/linkedin-content` ← `marketing/linkedin/skills/linkedin-content/SKILL.md`
  - `alir/product-team/ui-design-system` ← `product-team/skills/ui-design-system/SKILL.md`
  - `alir/product-team/product-skills` ← `product-team/skills/product-skills/SKILL.md`
  - `alir/product-team/apple-hig-expert/apple-hig-expert` ← `product-team/apple-hig-expert/skills/apple-hig-expert/SKILL.md`
  - `alir/project-management/meeting-analyzer` ← `project-management/skills/meeting-analyzer/SKILL.md`
  - `alir/project-management/senior-pm` ← `project-management/skills/senior-pm/SKILL.md`
  - `alir/ra-qm-team/iso42001-specialist` ← `ra-qm-team/skills/iso42001-specialist/SKILL.md`
  - `alir/ra-qm-team/risk-management-specialist` ← `ra-qm-team/skills/risk-management-specialist/SKILL.md`
  - `alir/ra-qm-team/ra-qm-skills` ← `ra-qm-team/skills/ra-qm-skills/SKILL.md`
  - `alir/research-ops/research-finance` ← `research-ops/skills/research-finance/SKILL.md`

## jl（JoelLewis/finance_skills）

- 总数 N = 91，抽样 n = 12
- 抽样方式：按 plugins/<插件> 分层按比例抽 12（最大余数法、每层至少 1），种子 20260924。分配：wealth-management 5、compliance 2，其余 5 个插件各 1。
- 抽中 id：
  - `jl/advisory-practice/advisor-dashboards` ← `plugins/advisory-practice/skills/advisor-dashboards/SKILL.md`
  - `jl/client-operations/account-opening-workflow` ← `plugins/client-operations/skills/account-opening-workflow/SKILL.md`
  - `jl/compliance/advice-standards` ← `plugins/compliance/skills/advice-standards/SKILL.md`
  - `jl/compliance/private-placements` ← `plugins/compliance/skills/private-placements/SKILL.md`
  - `jl/core/statistics-fundamentals` ← `plugins/core/skills/statistics-fundamentals/SKILL.md`
  - `jl/data-integration/market-data` ← `plugins/data-integration/skills/market-data/SKILL.md`
  - `jl/trading-operations/settlement-clearing` ← `plugins/trading-operations/skills/settlement-clearing/SKILL.md`
  - `jl/wealth-management/savings-goals` ← `plugins/wealth-management/skills/savings-goals/SKILL.md`
  - `jl/wealth-management/historical-risk` ← `plugins/wealth-management/skills/historical-risk/SKILL.md`
  - `jl/wealth-management/insurance-planning` ← `plugins/wealth-management/skills/insurance-planning/SKILL.md`
  - `jl/wealth-management/performance-reporting` ← `plugins/wealth-management/skills/performance-reporting/SKILL.md`
  - `jl/wealth-management/fixed-income-corporate` ← `plugins/wealth-management/skills/fixed-income-corporate/SKILL.md`

## hr（tuanductran/hr-skills）

- 总数 N = 146，抽样 n = 10
- 抽样方式：总体为 skills/hr-*（146 个；排除 .agents/skills 下 16 个开发工具 skill 与根 SKILL.md）。分两层：灌水层（HR×技术岗位/技术主题，共 23 个：hr-blockchain、hr-game-development、hr-backend、hr-frontend、hr-fullstack、hr-iot、hr-ar-vr、hr-mobile、hr-devops、hr-cloud、hr-embedded、hr-qa、hr-software-architecture、hr-system-design、hr-uiux、hr-security、hr-system-integration、hr-product-management、hr-prompt-engineering、hr-chatbot-design、hr-genai、hr-agentic-ai、hr-data）抽 2；核心 HR 层（123）抽 8。种子 20260924。注：按要求“避开 hr-blockchain、hr-game-development”并另抽 2 个灌水目录，实际抽中 hr-chatbot-design、hr-qa。
- 抽中 id：
  - `hr/hr-ai-adoption` ← `skills/hr-ai-adoption/SKILL.md`
  - `hr/hr-talent-intelligence` ← `skills/hr-talent-intelligence/SKILL.md`
  - `hr/hr-workforce-scenario-planning` ← `skills/hr-workforce-scenario-planning/SKILL.md`
  - `hr/hr-recruiting` ← `skills/hr-recruiting/SKILL.md`
  - `hr/hr-workforce-economics` ← `skills/hr-workforce-economics/SKILL.md`
  - `hr/hr-organization-network-analysis` ← `skills/hr-organization-network-analysis/SKILL.md`
  - `hr/hr-post-merger-integration` ← `skills/hr-post-merger-integration/SKILL.md`
  - `hr/hr-retirement-benefits` ← `skills/hr-retirement-benefits/SKILL.md`
  - `hr/hr-chatbot-design` ← `skills/hr-chatbot-design/SKILL.md`
  - `hr/hr-qa` ← `skills/hr-qa/SKILL.md`

## wsh（wshobson/agents）

- 总数 N = 15，抽样 n = 15
- 抽样方式：指定业务插件下全部 SKILL.md 共 15 个（content-marketing、customer-sales-automation、seo-* 在 HEAD 中无 SKILL.md），不足 25 个故全评。
- 抽中 id：
  - `wsh/business-analytics/data-storytelling` ← `plugins/business-analytics/skills/data-storytelling/SKILL.md`
  - `wsh/business-analytics/kpi-dashboard-design` ← `plugins/business-analytics/skills/kpi-dashboard-design/SKILL.md`
  - `wsh/hr-legal-compliance/employment-contract-templates` ← `plugins/hr-legal-compliance/skills/employment-contract-templates/SKILL.md`
  - `wsh/hr-legal-compliance/gdpr-data-handling` ← `plugins/hr-legal-compliance/skills/gdpr-data-handling/SKILL.md`
  - `wsh/payment-processing/billing-automation` ← `plugins/payment-processing/skills/billing-automation/SKILL.md`
  - `wsh/payment-processing/paypal-integration` ← `plugins/payment-processing/skills/paypal-integration/SKILL.md`
  - `wsh/payment-processing/pci-compliance` ← `plugins/payment-processing/skills/pci-compliance/SKILL.md`
  - `wsh/payment-processing/stripe-integration` ← `plugins/payment-processing/skills/stripe-integration/SKILL.md`
  - `wsh/quantitative-trading/backtesting-frameworks` ← `plugins/quantitative-trading/skills/backtesting-frameworks/SKILL.md`
  - `wsh/quantitative-trading/risk-metrics-calculation` ← `plugins/quantitative-trading/skills/risk-metrics-calculation/SKILL.md`
  - `wsh/startup-business-analyst/competitive-landscape` ← `plugins/startup-business-analyst/skills/competitive-landscape/SKILL.md`
  - `wsh/startup-business-analyst/market-sizing-analysis` ← `plugins/startup-business-analyst/skills/market-sizing-analysis/SKILL.md`
  - `wsh/startup-business-analyst/startup-financial-modeling` ← `plugins/startup-business-analyst/skills/startup-financial-modeling/SKILL.md`
  - `wsh/startup-business-analyst/startup-metrics-framework` ← `plugins/startup-business-analyst/skills/startup-metrics-framework/SKILL.md`
  - `wsh/startup-business-analyst/team-composition-analysis` ← `plugins/startup-business-analyst/skills/team-composition-analysis/SKILL.md`

## lenny（RefoundAI/lenny-skills）

- 总数 N = 76，抽样 n = 8
- 抽样方式：单层，random.Random(20260924).sample(sorted(全部路径), 8)。
- 抽中 id：
  - `lenny/ai-assisted-prototyping` ← `skills/ai-assisted-prototyping/SKILL.md`
  - `lenny/stakeholder-alignment` ← `skills/stakeholder-alignment/SKILL.md`
  - `lenny/enterprise-sales-motion` ← `skills/enterprise-sales-motion/SKILL.md`
  - `lenny/team-culture` ← `skills/team-culture/SKILL.md`
  - `lenny/building-a-promotion-case` ← `skills/building-a-promotion-case/SKILL.md`
  - `lenny/pr-and-press` ← `skills/pr-and-press/SKILL.md`
  - `lenny/international-expansion` ← `skills/international-expansion/SKILL.md`
  - `lenny/org-design` ← `skills/org-design/SKILL.md`

## dp（deanpeters/Product-Manager-Skills）

- 总数 N = 77，抽样 n = 4
- 抽样方式：单层，random.Random(20260924).sample(sorted(全部路径), 4)。许可 CC-BY-NC-SA-4.0，G1 全部 fail。
- 抽中 id：
  - `dp/agent-orchestration-advisor` ← `skills/agent-orchestration-advisor/SKILL.md`
  - `dp/tam-sam-som-calculator` ← `skills/tam-sam-som-calculator/SKILL.md`
  - `dp/discovery-interview-prep` ← `skills/discovery-interview-prep/SKILL.md`
  - `dp/user-story-mapping` ← `skills/user-story-mapping/SKILL.md`

## evolsb（evolsb/claude-legal-skill）

- 总数 N = 1，抽样 n = 1
- 抽样方式：全部。仓库唯一 skill 文件位于根目录 `skill.md`（小写），id 规则下目录为空，故用仓库名作 id：evolsb/claude-legal-skill。
- 抽中 id：
  - `evolsb/claude-legal-skill` ← `skill.md`

## askills（anthropics/skills）

- 总数 N = 19，抽样 n = 6
- 抽样方式：按指定清单：brand-guidelines、internal-comms、doc-coauthoring、skill-creator、docx、xlsx（总体为 skills/ 下 19 个，不含 template/）。docx、xlsx 为 Proprietary 许可，G1 fail。
- 抽中 id：
  - `askills/brand-guidelines` ← `skills/brand-guidelines/SKILL.md`
  - `askills/internal-comms` ← `skills/internal-comms/SKILL.md`
  - `askills/doc-coauthoring` ← `skills/doc-coauthoring/SKILL.md`
  - `askills/skill-creator` ← `skills/skill-creator/SKILL.md`
  - `askills/docx` ← `skills/docx/SKILL.md`
  - `askills/xlsx` ← `skills/xlsx/SKILL.md`
