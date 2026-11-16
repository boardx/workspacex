# A3：本轮真实教学回复的独立内容核对

本记录是Agent对实际脱敏产出的独立源码/内容核对，**不是人类教学评分、课堂研究证据或人工签核**。机械链路通过与提问体验分别记录；不新增模型任务，不修改已签Skill或重发以改善文案。后续S2–S6/SUM只有实际产物到达后才补结论。

## S1：实际回复核对

来源：[completion-s1.json](../a6/real-completion-20261116/completion-s1.json)。实际run：`68880459-6de1-43a8-a909-0a969f03a7a8`；本次选定S1 V1，学生随后显式保存为V2；来源回执为`message-dispatch-observed`，`stageSavedByAgent:false`，新登录精确回读标志为true。此处只是读取已经记录的真实结果，没有重跑模型。

| 核对项 | 实际内容与来源 | 本次判断 |
| --- | --- | --- |
| 阶段身份 | 开头明确“第1步（理解与提出问题）”；未误称共情/empathize。 | 本次回复阶段正确；不据一次回复推断后续各阶段 |
| 保存材料对应 | 逐项复述活动、原始问题、人群、场景、guess、sourceDetails、uncertainty、why；与before.fields逐项比较，没有增加实际经历、年龄或经验数据。 | 该回复可对应本次真实S1 V1字段；不是仅有wire marker的旧证据 |
| 合成与猜测 | 明说“以上材料均为合成课堂猜测，未包含真实观察或访谈证据”；实际人群年龄/经验未知、没有实际观察、问题是否存在待研究均保留。 | 未把输入的猜测升级为研究事实 |
| 虚构访谈或点评 | 未声称已采访、已观察、已测试、教师认可；“犹豫、走错或询问”以提问中的可能经历出现。 | 本次未发现虚构已发生访谈/教师点评；例子仍须由学生核实 |
| 学生决定与保存 | 使用“能不能”“有没有办法”征询；没有替学生确认/选择/保存。实际after由脚本模拟的学生审阅，选择先征求同意并听取一次经历，保留不同方向和猜测；没有照抄AI的观察建议为已执行事实。 | 本次机械证据保留学生选择与显式保存；不代表真人学生已经认可该建议 |

### 提问体验的具体待审点

完整回复551字符，先列7项材料，再给166字符追问段。追问段实际含3个问号：先问来源属于经历还是猜测，再分别追问经历细节与未来观察办法；材料复述中另有1个原命题问号。因此不能把测试中“含问号”的通过称为“只问一个问题”已经满足。

10–15分钟观察是AI新增的可选活动建议，明确是将来可能行动，没有当作已开展研究；但它在学生已经说明没有观察/访谈证据后，又追问“是否基于亲眼经历”，并连续加入两条条件分支，可能增加初学者负担。建议真人教学审阅时观察学生能否先回答核心来源澄清题，再自行决定是否观察或访谈；本记录不因此立即改变第一步引导方式或Skill内容，也不新增收费请求来取得更短答案。

当前结论仅为：**本次阶段与来源边界正确，未发现虚构访谈；单一追问与节奏要求存在可见偏离，教学适切性仍待真人审阅。** 实际技术actor/合成输入不证明普通学生具备模型额度、真实研究成功或全组共识。

## S1：零费用指令来源诊断

**归因范围更正：此前“未找到强制完整复述”只限所检查的Skill正文、UI与学生prompt，不能据此排除所有配置原因，也不能定论为纯粹模型自行展开。** A1随后[实证读取S2基础指令](../a1/context-stack04-s2-agent-base-instructions.json)：旧不可变版本`agent-fullstack-yr-c7e722d0-fc9ebf5fdbbe-v1`精确匹配公开echo测试夹具，指令digest为`49b0f07ba859d6b961a5317893450eaedaf9062ae593cf0278a41e5ed3408726`。S1的`turn.agentVersionId`也是同一版本。因此本次S1同样带有echo基础角色，系统层echo指令本身可能与教学提问冲突或促成复述，不能视为已经排除。此事实不改写原回复；上文阶段正确、来源边界与实际三问观察仍只是该次输出的内容结论，**不是canonical教学基础版本已通过验收**。

| 来源 | 已读到的实际规则 | 对本次长回复的解释边界 |
| --- | --- | --- |
| `skills/aidt-methods/aidt-understand/SKILL.md:12` | “一次只问少量有帮助的问题” | 允许的量较宽，但没有要求完整复述全部材料。 |
| 同文件第33行 | “一次追问一个最关键未知”，给方向时需等待小组选定 | 比总规则更具体，不要求一条消息展开所有流程；这些Skill规则本身未强制多问，不能据此排除echo基础角色或其他system指令的影响。 |
| `apps/web/features/aidt/lib/project-aidt.ts:18` | UI阶段描述要求先价值/来源，等回答，再查人群/场景并等学生选择 | 描述串含后续流程，但当前原生Chat不引用`step.prompt`，没有证据显示它作为本run的额外指令进入模型；不能靠改此显示字段宣称运行问题已修。 |
| `aidt-chat-empty-state.tsx` / `aidt-stage-output.tsx` | 空态提示学生写原命题；成果带入只把学生稿交给原生composer审阅 | 没有强制模型逐项复述的offer指令；本次验收实际发送的是记录中的自定义学生请求。 |
| `aidt-v2-completion.spec.ts:45` 与实际`turn.studentInput` | “先核对本步已保存材料，只追问一个…” | 要求核对，未要求把核对过程写成7条列表；没有“只输出一句、不展开条件分支”的更窄表述。 |
| `application/aidt-run-context/prepare.ts` | 把精确保存材料以有界不可信JSON参考块呈现，保留学生决定/不确定性 | 没有要求全量材料复述、预设观察10–15分钟或连续三问；不能据此确认完整原生system/agent instructions无其它影响。 |
| A1实际基础指令审计与S1真实`turn.agentVersionId` | S1/S2使用同一旧echo基础版本，A1核到该版本精确匹配公开echo夹具 | 此层确有非教学echo任务指令，可能引发复述/教学目标冲突；之前的Skill/UI范围检查不能将它排除。 |

离线验证：仓库`aidt-methods@1.3.0`包内aidt-understand的SKILL.md与当前源文件逐字节相同，文件SHA256为`bb1f9f8bfa2ac3f3ac623f2c0d52692d94cbf3e3d454f605f089698491c18e84`，包digest为`5824ee477dcb39fa8a9509a50641eeeea1e14da03fe451291d92678bab597d1a`。另外解码检查allowlist中的1.0/1.1/1.2：同样没有“先完整复述”要求，均含一次一个关键未知。实际pin已由A2[独立只读审计](../a2/source-audit-20261116/s1-report.json)核实：`skill-version-625a892f-1b6f-42e0-9306-fe2059426b54` / `aidt-understand`的完整包字节校验后，精确匹配`aidt-methods@1.3.0`；canonical文件manifest摘要为`9a3d1e6bdf3ced5860a4f1124edb1be05fb7f952039c9549fbff50eb89ac52ee`。该manifest摘要、上面的SKILL.md文件SHA与release包digest是不同对象，不混称；结论来自actual pinned content匹配，不由bootstrap默认推断，也不声称平台导入账号血统。

**最小建议仅针对未来学生请求的表达**：可把“核对”限定为内部核对，并补“无需逐项复述；只输出一句核心问句，不追加条件分支或预设活动时长，等学生回答再追问”。这仅是未来请求级澄清，不涉及新课程方案、服务或权限；须先独立核实教学使用的是正确canonical基础角色，再评价其效果。仅改这句请求不能证明echo配置问题已修或canonical教学表现已通过，不修改现有运行，也不保证模型一定遵从。本轮不据此重发S1或改过往记录。

若未来决定改变Skill持久规则，需另一个明确发布坐标与新的文件/包digest；`build-aidt-methods-pack.ts:31–35`禁止改写已有release，服务器`approved-packs.ts`只认固定allowlist。更新来源MD而覆盖1.3.0 JSON、只换digest不换版本，或静默把现有thread升级，都不合法。仅改UI未被消费的描述也不能算模型表现已修。当前没有修改已签包、注册表、allowlist、产品源码或运行数据。

## S2：新增一次补测的实际失败（不替换原失败）

原S2 `8a4188ab-7fa9-4b7c-a56f-ec059b0e290e` 的echo任务误识、未批准的意图卡与最终cancelled结果继续保留；其旧费用、旧线程和旧账记录不因本节改变。这里记录的是用户另批一次补测后的新事实。

实际来源：[attempt02执行记录](../a6/real-completion-20261116/s2-supplement-attempt02-execution.json)、[actual wire/来源回执/失败附件](../a6/real-completion-20261116/s2-supplement-attempt02-attachments.json)、[picker零模型诊断](../a6/real-completion-20261116/s2-supplement-picker-zero-model.json)。新线程为`thr-0a23a022-c27f-43c4-96dc-0f40cd31b9d1`；本次唯一send产生真实run `40539aa6-2732-4661-9665-913013af806d`，实际终态失败，`NATIVE_RUN_FAILED_MODEL_CALL_FAILED`；执行退出1，`automaticNewSendRetry:false`。

| 层级 | 本次实际材料能证明什么 | 不能据此填写的结果 |
| --- | --- | --- |
| picker前置 | 零SDK诊断中真实目录GET200，正常选择后`auto-match:false`、popover关闭，`nativeRequests:[]`；本次attempt02随后走到唯一native send。 | 不代表引导师回复/教学通过；原picker首次红仍保留，未由本诊断确定产品竞态根因。 |
| 基础角色准备 | pre-send proof及普通能力图核到新canonical published指针，与已审阅夹具digest一致。 | 这只是前置证据；本失败附件没有成功turn的actual agentVersion核验，精确失败run版本/提供方原因由A1/A2独立审计，不从指针猜模型已消费。 |
| 范围、来源与组装 | selector精确为S1 V2+S2 V5，固定S2 pin `skill-version-f4341571-f25b-4d21-98bf-55f70aca90e6`；真实snapshotHash `326557fd5f9b8c5f2d30c8c9bec8c2a820ffbbf8e4c7787f071a8106c723968a`；所捕获的`frozenReceipt.application`为`assembled`，prepared/assembled时间非空，`truncated:false`。 | `messageDispatchedAt:null`、checkpoint时间为空，这份附件没有来源派发事实，不能写模型已收到/已消费材料；最终journal另待独立审计。也不能从缺派发回执推断供应商物理请求数或费用为0，计量等A1实际账。 |
| 回复与任务意图 | 此次actualfailure附件没有`assistantText`或成功持久reply，`intentChoices:[]`；A6报告无assistant/HITL。 | 没有可审阅的真实追问或意图文本；不能从`MODEL_CALL_FAILED`合成一条教学反馈，也不能判本次是一问/多问、echo已消除或canonical教学质量通过。 |
| 学生后续与保存 | 测试在唯一native helper的failed分支停止，未到本次回复后的学生修订、共享保存及新登录回读；未写完成S2 predecessor。此前人工fallback S2 V5仍是既有材料。 | 不能把前期V5人工稿或S1回读标为本次“学生看完AI后决定并保存”；也不声称项目此前从未有保存。 |
| 旧记录与预算 | 执行记录显示legacy/S1两旧budget hash前后相同；本次slot已reserved/send/run出现，新独立账保留失败占位。 | 不能把失败当成未用额度自动重发或退额；旧费用结算、远端checkpoint和关窗计量由A1实际独立记录，本文不补造。 |

**本次结论：前置选择与来源组装走通，模型运行失败；教学内容不可评价，学生回复后决定/保存/新登录未完成，S2补测不通过。** 未从error生成替代教学内容，未改原S1或旧S2实际结果，未重发模型。按当前约定暂停其余5个原生任务及2个Design任务；后续是否继续由新的明确协调决定，不能把此处当执行授权。

### S2：晚到的实际journal独立核对（保留早期快照）

已实际读取A2的[新失败run审计报告](../a2/s2-supplement-audit-20261116/actual-failed-run-report.json)与[退出0日志](../a2/s2-supplement-audit-20261116/actual-failed-run.log)，不是同目录的旧S1 baseline。审计时间为`2026-11-16T14:22:33.752Z`，目标仍为新失败run `40539aa6-2732-4661-9665-913013af806d`。本段补足前表当时尚待核验的来源与派发项；**不回写或替换A6早期的assembled浏览器快照**。

- DB journal seq2在`2026-11-16T14:20:48.750Z`真实记录`message-dispatch-observed`；snapshotHash仍为`326557fd5f9b8c5f2d30c8c9bec8c2a820ffbbf8e4c7787f071a8106c723968a`，实际提交观察的blockHash为`e9527c822d1d11a723ed7676fdc17c5eca5a45de116f04c06c10e4298e73a6f6`，均与冻结来源一致。其后seq3在`14:20:50.442Z`记录failed，运行终态仍为failed。较早浏览器只捕获assembled与后来journal出现提交事实并不矛盾。
- actual run使用canonical Agent版本`agent-version-fixture-428d072b-cf41-465b-86f7-6b02fe39136f`；唯一focus为`aidt-empathize`的`skill-version-f4341571-f25b-4d21-98bf-55f70aca90e6`，完整包匹配`aidt-methods@1.3.0`。S1 V2与S2 V5的精确已保存投影匹配冻结摘录，均未截断；这不是只核pre-send发布指针。
- 实际新local线程、journal观察到的remote线程命名空间与remote run均与旧S2记录分离，`resumeObservationCount:0`。这证明此次观察范围内没有沿用旧resume；未读取或宣称掌握LangGraph完整checkpoint正文。旧run、旧6条消息、snapshot/application子集及旧不可变版本hash仍匹配。
- **该事实仅为向原生服务提交消息的观察，不证明供应商内部已收到、实际模型推理成功或正确消费了教学材料。** A2报告明确`supplierConsumptionProvenByAudit:false`；`modelRequestsSent:0/dataWrites:0`仅指其只读审计动作，不能当作本次模型运行零费用。
- 仍没有可审阅assistant回复或学生后续保存/新登录，教学内容不可评价、S2不通过及其余任务暂停的结论不变。费用/用量与未决占款继续以A1最终安全计量为准，当前不能标零费用或已结算，不能因失败自动补发。

## 后续实际产物

S2新增补测已记录上述失败，没有教学回复可审；S3–S6及SUM仍没有本轮实际内容，不填通过、不从脚本预测模型表现。SUM如经另行明确协调执行并产出，才继续核对旧S6返回记录、当前六步来源、无点评/原件字节缺口、报告主动导入保存与真实导出字节。
