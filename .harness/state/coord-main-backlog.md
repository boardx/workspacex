# coord-main 工作 backlog（派生梳理，非权威）

> 权威永远是 GitHub issue 本身；这份文件是 coord-main 对 125 个开放 issue 的一次全量梳理、
> 分优先级、分配 owner 的快照，用来驱动"一步一步解决"，不是第二份规格。
> 生成于 2026-08-14（coord-main），基线 SHA `133cf45e`。过期请重新梳理，不要死信这份文件的数字。

## 本轮梳理已关闭的 5 个（重复/已解决，附证据）

| # | 结论 |
|---|---|
| #1161 | 与本会话今天修的 #1155 是同一个问题（VZ-fabric mock 未申报），已解决 |
| #1047 | 同类问题更早实例（chat-viz.ts 未申报），DECLARED_MOCK_DEBT 早已收录，已解决 |
| #594 | `personal-chat-screen.tsx` 头注直接引用本 issue 为构建依据，今天多轮迭代验证功能存在，已解决 |
| #877 | CLR track R round3 重评（本会话内）证伪其两条阻塞理由，已过期 |
| #1091 | `apps/api/vitest.config.ts` maxWorkers=1 已落地（多轮 PR #1017→#1090），未再复现 |

## Tier 0 — P0，真实、需要立刻分配 owner

| # | 标题 | 现有 owner 标签 | 分配 |
|---|---|---|---|
| #852 | skill 审核人职能任命零产品路径（R8） | 无 | → 待分配（skill 域） |
| #853 | createAgendaSegment 有 controller 但前端零调用方（R10） | 无 | → 待分配（project 域） |
| #854 | 录音授权界面纯 mock，setConsentDecision 零前端调用（R7） | 无 | → 待分配（rec 域） |
| #925 | 通用助手 MODEL_PROVIDER_NOT_CONFIGURED / 闪烁 / Enter 交互 | area:chat | → chat dev 线 |
| #572 | MCP 中间层没接（8 契约操作零 controller/UI） | owner:coord-chat-e2e | 维持 |
| #583 | 并行度准入分母应是 CPU 核不是栈数 | owner:coord-architecture | 维持（今天再犯过一次，见本轮资源清理） |
| #956 | PR 作者绕过独立 review 与 Closes 门 | area:harness | → 待分配（harness 治理） |
| #624 | 全链路验收规格 epic（后台上传→注册→chat 真调用） | owner:coord-main | 统一队列首位历史条目，需要拆成可执行子项才能推进 |

## Tier 1 — 今天工作衍生的真实缺口（P1，已有清楚上下文）

| # | 标题 | 建议 owner |
|---|---|---|
| #1201 | F176 消息级评价落地 | org-admin 线（已在做，issue 已建） |
| #1177 | 契约声明 path 但 interface 无路由的机械门提案 | org-admin 线（已开，P1 不阻塞） |
| #1178 | 总览屏导出/月报按钮无人认领 | org-admin 线（已开） |
| #1222 | F155 L3 context-pack 检索接线进 chat | chat dev 线（design-delta #1181 已签，等实现） |
| #1159 | /skill 后台 8 项修复 | 待分配 |
| #1150 | F174 /rec 收尾误报转录失败 | 待分配（rec 域） |
| #1147 / #1224 | Survey 新建问卷模块默认空白 / 编辑与创建区分 | survey 域（今天已有 #1148 合并，剩余部分） |
| #1142 | 110/290 feature owner 为 null（rev-e2e 已提规范化提案） | 待分配（harness 治理） |
| #1121 | skills/asset-governance 缺"创建空白骨架"契约 | 待分配 |
| #1105 | skill catalog 编辑能力落点缺失 | 待分配（产品决策优先，见 3 候选） |
| #1094 | feature 编号竞态（同日连撞两次号） | 待分配（harness 工具） |
| #1039 | project-create-smoke 并发下 403 计两次 | 待分配（e2e 稳定性） |
| #1025 | verify --sprint 覆写他人 evidence | 待分配（harness 工具） |
| #1021 | .harness 并行污染 flake | 待分配（harness 工具） |
| #1019 / #1018 | verify-ui-states 性能 + 三条真红 | 待分配（harness 工具） |
| #999 | 归档被拦截无错误码（P7 攒批 delta） | project 域（已知，攒批中） |

## Tier 2 — coord-architecture 名下 backlog/out-of-scope（约 40 条）

已经打了 `owner:coord-architecture` + `backlog`/`out-of-scope` 标签，是该角色自己的存量清单，
**不在本轮驱动范围内**——不重复罗列，需要时看 `gh issue list --label owner:coord-architecture`。

## 下一步（本轮执行顺序）

1. Tier 0 八条：逐条确认是否有活跃会话能接，没有就先分配 issue 但不占 claim 槽，等下一个空闲会话认领。
2. Tier 1 依赖今天已有上下文的（#1201/#1177/#1178/#1222）已经在跑，只需继续跟进 review/merge。
3. 其余 Tier 1（无 owner）逐条评估是否需要先出 design-delta（契约变化）还是可以直接 chore 走。
4. Tier 2 保持现状，coord-architecture 自己的节奏。

_本文件由 coord-main 手动维护，不是自动生成——每轮开工前先跑
`gh issue list --state open` 核对是否有新开/新关的，再更新这份快照。_
