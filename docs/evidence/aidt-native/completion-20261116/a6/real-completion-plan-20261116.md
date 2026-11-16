# 同组真实模型完整链：准备记录

状态：本次S1机械链已实际通过但教学单一追问失败；S2真实请求被错误echo基础夹具阻断并取消，旧额度仍占用。S3–SUM与本次两个Design任务未运行。另两项零费用清单PDF/S6独立原件通过。下面保留原依赖设计，不能当作整链已完成；[实际索引](./real-completion-20261116/README.md)为结果来源。人工签名栏不改写。

```mermaid
flowchart LR
  Q[QA 红绿与静态检查]:::tested --> S1[S1 机械通过/内容缺陷]:::tested --> S2[S2 错误base任务已取消]:::blocked --> S3[S3 暂无与HMW]:::pending --> S4[S4 三描述单与PDF字节]:::pending --> S5[S5 学生确认问题]:::pending --> D1[A5 Design V1]:::pending --> S6[S6 认识与return2]:::pending --> D2[A5 新return5与V2关系]:::pending --> SUM[SUM 历史与报告导出]:::pending
  classDef pending fill:#e5e7eb,color:#111827
  classDef tested fill:#ede9fe,color:#4c1d95
  classDef blocked fill:#fee2e2,color:#991b1b
```

## 授权与预算

- 旧账本 `native-model-run-ledger.json` 保持 maximumNativeModelRuns=7；两次已独立证明未派发的失败与一条旧 S1 已收费记录原样保留。准备时只读基线 SHA256 为 `a12c648eacd3bf54a22d87c266273af290db6f972328109febc83b29b5c93806`，当时有效已占 1、剩余 6 供 S2–S6 与 SUM；本次S2实际取消后仍占用一次，当前剩余五次不是补测S2许可。
- 新 S1 使用另一个绝对 `.json` 路径；其 schema 固定 maximumNativeModelRuns=1、authorization=additional-s1-20261116。显式授权开关缺失、路径与旧账本相同、已有一次尝试均拒绝。失败或未知不会退回额度，也没有自动 reconciliation API。
- A5 另有最多两次 Design 任务的独立补充账本，与七条 native 任务分别记账。一个 native task 可能有多次物理模型请求，任务数不等于 completion 数；实际 usage/settlement 由 A1 独立核对。
- 同一实际 funded admin 技术 actor 经正常登录使用自己创建的小组与 Design；其技术模型成功不证明普通学生有余额或已完成课堂验收。不得改角色、余额、plan 或隐含授予工具权限。
- 每个 task 只有一次首次 SDK send；失败后保留 run 与账本，停止并诊断。只可按明确授权审阅同 run 的 synthetic `confirm_task_intent` 卡继续，不自动批准其他工具或新请求。

## 可复现入口与依赖

专用真实外部栈 config：`apps/web/playwright.aidt-v2.config.ts`；精确 spec：`apps/web/e2e/aidt-v2-completion.spec.ts`。默认 fullstack CI 精确排除此收费 spec；发现用例不等于已运行。

每次只选择一个 `completion S1:`、`completion S2:` … `completion S6:` 或 `completion SUM:` 的 grep，且设置相同的 `AIDT_V2_AUTHORIZED_PHASE=s1|s2|s3|s4|s5|s6|sum`。私有 `AIDT_V2_COMPLETION_STATE` 为绝对 JSON 路径，记录同一个 project 与前序完成结果；已经尝试的 phase 拒绝重跑。原有分组场景保留，不能拿它们拼成这条完整链。

| 顺序 | 操作与不变量 | 当前实际结果 |
| --- | --- | --- |
| S1 | 新自有合成组；学生先填问题/理由/猜测来源并保存未确认稿；一次新 native task；核冻结 refs、singleton pin、真实 dispatch；学生重写主题后保存；新登录精确回读 | 机械1pass/18.7秒；单一追问false，基础echo夹具冲突 |
| S2 | 同组承接 S1 的真实已存版本；真实原件/发现卡与分栏，唯一Agent请求 | 已真实派发后错误echo理解、未审批且cancelled；人工fallback清单另存V5不算AI成功 |
| S3 | 同组承接 S2；明确暂无意外而非强造洞察；一次 Agent 后学生确认暂无与待验证 HMW；新登录 | 待测 |
| S4 | 同组承接 S3；三个不同点子的名称/2–3句说明/真实持久 PNG；一次 Agent 后学生多标签分类、理由与选择；真实 beforeprint；将实际打印 DOM 副本交 Chromium 生成 PDF 字节并解析正文/校哈希，明确未自动操作另存为窗口 | 待测 |
| S5 | 同组学生在制作前写问题、认识、依据、限制、原型类型/任务/情境；真实 UI 勾选 S3/S4 来源；一次 Agent 后学生确认保存；交 A5 真实版本生成 | 待测 |
| Design V1 | A5 只读核现有 S3/4/5，正常创建关联 owner Design；仅一次明确 v1 任务，真实 source=model、不可变版本 GET；学生选择并保存 S5 ref，带入冻结 S6 snapshot | 待测 |
| S6 | 同组真实 Design IDs/版本 GET；测试反馈明确 synthetic；一次 Agent；学生确认无认识变化、return2、保留旧问题与旧原型且不强制 V2；保存与新登录 | 待测 |
| Design V2 | A5 另存新的 return5 决策并保留旧 return2；推进 S5 新问题作为反证；只在显式任务窗口按旧 S6 snapshot/反馈生成一次 V2，保存旧版→反馈→新版本关系 | 待测 |
| SUM | 同组六步实际 heads；必须读取到旧 S6 confirmed return2 修订，独立 summary thread/pin；一次 summary task；receipt 精确 current/history；人工原段保留、学生审阅 AI 消息后导入并主动保存；下载 Markdown 含明确保存来源 footer，逐字节比较；新登录报告正文回读 | 待测 |

## 已运行的零费用 QA（不是真实模型通过）

2026-11-16：补充账本 3、同组 phase 状态 2、既有 selector/receipt/wire 25，共 30 单元测试通过；包含跨 Node 进程重复尝试阻断、旧账本字节不改。两项新模块先出现缺实现红测，日志 `/tmp/aidt-supplement-red.log`、`/tmp/aidt-completion-state-red.log`，绿测 `/tmp/aidt-completion-qa-green.log`。Web 全量 `tsc --noEmit --incremental false` 退出 0，owned ESLint 退出 0，spec 精确发现 7 条，diff-check 退出 0。没有供应商、没有浏览器收费请求。

## 证据判据与明确缺口

每条 native 保存真实 run/thread/inputMessage、actual mounted version、严格 selector、独立服务端精确历史 GET、snapshotHash、application attempt/hash/时刻与实际派发或合法同 run resume；同时核 Agent 没有自动改六步保存稿。浏览器只传 `forwardedProps.aidtContext` 坐标，原生 messages 保留学生输入（含主动引用），不能以 wire 含文本当服务端消费。

S4 的机器 PDF 字节是 Chromium 从实际产品 beforeprint 文档副本生成，证据必须如实标注；它不证明人类已在操作系统打印窗口保存，也不替代 PDF 教学人工验收手册。SUM structured report source refs 与原人工正文来源保持原规则，不盲改成模型 run 的所有 heads；AI 消息/run 的来源另记。

已有真实 PG return-only 正反验收由 A2 独立记录，不加额外收费浏览器任务。普通学生资金/课堂教学适切性、真实访谈/真实用户测试、教师点评、语音录音与人工签名继续单列，不因本条技术模型成功而自动通过。

## 后续S2最小补测方案（仅准备，未获新额度、未执行）

1. root/A5先完成只限隔离测试夹具的canonical默认base新不可变版本，并由A1独立核实际指令hash、旧default pointer CAS与旧历史保留。不得改变旧run的agentVersion、既有Skill/权限/余额。
2. 先正常GET旧S2 thread确认真实visibilityScope；现有`live-aidt-step-chat.ts`第98行create分支为plenary、显式thread读分支只接受plenary，必须一致，不一致停止而不改隐私范围。复用本次group，通过既有`chat.operations.mutateThread`正常API `POST /chat/threads/mutate` 建新的plenary线程。完整输入为`{op:"create",projectId:P,threadId:null,groupId:null,title:"[AIDT 2] 合成课堂补测",visibilityScope:"plenary",expectedVersion:null,reason:null}`，出参取真实threadId/version/auditEventId，不能自造。
3. `GET /threads/:threadId/skill-deviations?projectId=P`取真实乐观版本；既有`POST /threads/:threadId/skill-mounts?projectId=P`传`{threadId,skillIds:[真实已启用aidt-empathize的skillId],expectedVersion:实际version}`，再GET确认只有对应已批准pack的唯一active pin。没有修改Skill内容或降低general focus guard。
4. 正常打开`/aidt/P?step=2&tool=chat&thread=<new>`，现有host严格核项目/共同范围/可写与S2挂载。当前“使用新版另开本步对话”按钮只在Skill有新版本时允许，不能拿同Skill版本伪造更新。原生`chat-thread-create`能创建空组线程，但不能把空线程未经挂载直接当有效S2对话。
5. 将来若获新的一次S2任务授权，另建独立maximum=1补充账本与新的QA phase尝试。旧七次失败entry、S1补账、旧thread/run/card/snapshot及其费用全部不删不重置，也不把人工fallback当已完成AI任务以解锁S3。
6. 仅一个新SDK send，确认实际run指向新canonical默认Agent不可变version，approved S2 Skill pin精确不变；新Deep远程thread不能承接旧echo checkpoint。读取真实当前S1V2/S2V5（人工稿）坐标与快照/派发回执，保留AI与学生输入、学生决定保存及新登录。实际更进一步head变化时以独立GET核定，不硬写预期版本。
7. 本节没有执行任何建thread、mount或供应商请求，不算补测通过。重验费用授权仍待root审阅/用户明确额度；当前模型窗口关闭。
