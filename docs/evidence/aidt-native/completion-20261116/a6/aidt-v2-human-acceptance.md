# AIDT V2 人工端到端测试与验收手册：新版待执行方案

更新：2026-11-22T04:52:53.322217+00:00；状态：**全部 NOT_RUN，未执行**。本次更新同一工程原件，不建立第二个tracker。原H01–H15及M历史原文逐字保留在文末历史区；旧版“本轮”、旧授权、旧额度、静态优先和录音另排仅对应其当时记录，不能覆盖以下最新批准范围。

原件：[GitHub精确源码](https://github.com/boardx/workspacex/blob/34c76bce813a86ff03aeae75d79b8c69758f89fb/docs/evidence/aidt-native/completion-20261116/a6/aidt-v2-human-acceptance.md)；原件SHA256 `977ec3673f07ba35e04cb47ef0233c002e5a17118f0e45259f102edb1d7396e6`。需求为V2正文加用户已批准的最新方案/语音：[原看板](https://chatgpt.com/space/page_78bc9016074481918252b6ea34bdbbea)顶部批准方案，引用#6907/#6958–#6962既有条目，不另开issue。本文件是计划，不是产品实现、模型响应、CI、Dev部署或人工签核成功证明。

## 本轮控制实现与待执行清单（2026-11-22，代码冻结审阅稿）

全部真实浏览器、模型、ASR、OS打印和新Dev验收仍为NOT_RUN；旧H/M/D记录不能覆盖本轮112案。

- 显式新profile `v2-voice-20261122`；manifest SHA256 `0f5b154d8079826904722efde77dbf8296d955714d7ec9bc25885bbd9db405c7`。六步正向正常UI处理器、具名调用守卫已实现未实跑。完整112案自动执行器尚未全部实现，不能批量结算为通过。
- 当前37份正式产物×三纸型，共111具名PDF；保留暂无及其后有实际材料支持的found两个正式版本。
- 具名推导：592个physical mutation上限；教学57、Design模型3、ASR2、原生Research5、Survey13。并非调用或费用回执；旧44/16/263不改。
- 正向处理器：正常创建→学生实际反馈修订→显式确认/刷新；访谈和观察两独立来源；S3真实模板与HMW、暂无→found；六法两轮/两轮各3份描述单和分类；S5单选及三选/V1→V2/真实图片导入/HTML及WebApp；S6三路径、真实ASR工具与发布、Survey8份实际匿名表单及当前原生报告、1模拟persona的原生UserResearch、同卡新版关系和正式打印；系统报告与V3不能改写V2的实际回链。所有这些仍需精确Dev实跑。
- 工具未完整覆盖：112案的完整权限/撤权竞态、失败恢复、IME键盘生命周期、逐案证据结算。现有子检查不足保留NOT_RUN/BLOCKED，root在Dev后按同一手册实际探索/人工或半自动补验，不从stage checkpoint/Pure绿或派工计通过。工具缺口不新增产品发布门。
- 8份答卷为QA场景与原有分享最小样本门适配，不是V2访谈人数要求；保现有每block隐私门。实际AI提案经正常学生编辑为3开放题，保存原/改稿hash，8个独立匿名UI提交后正常UI生成当前原生报告。
- 合成语音源脚本不交业务模型。ROOT动态审实际owned run的audio/publish短时once，软件校对reviewMethod=synthetic-speech-groundtruth、manualListeningVerified=false，不冒称真人回听/C1。未知工具/写结果不重放。
- 正式S2/S4预览核实际来源图hash和数量，缺图卡须0图片；实际PDF逐页独立核尺寸/图文/分页后才可人工确认。OS能力缺失只PRINT BLOCKED，headless page.pdf不代OS窗口。单文件32MiB/100页，全run PDF512MiB、渲染PNG1GiB。

正式产物（每项A4/A3/A1，全部NOT_RUN）：

- S1 `confirmed-problem-reflection`（problem-main；默认A4）
- S2 `source-1-guide`（source-interview；默认A4）
- S2 `source-1-discovery-card`（source-interview；默认A4）
- S2 `source-1-asr-report`（source-interview；默认A4）
- S2 `source-2-guide`（source-observation；默认A4）
- S2 `source-2-discovery-card`（source-observation；默认A4）
- S3 `confirmed-surprise`（surprise-main；默认A4）
- S3 `confirmed-surprise-revised`（surprise-main；默认A4）
- S3 `confirmed-persona`（persona-main；默认A1）
- S3 `confirmed-hmw`（hmw-main；默认A4）
- S4 `confirmed-classification-and-selection`（method-free；默认A4）
- S4 `idea-description-1`（idea-one；默认A4）
- S4 `idea-description-2`（idea-two；默认A4）
- S4 `idea-description-3`（idea-three；默认A4）
- S4 `round-b-classification-and-selection`（method-reverse；默认A4）
- S4 `round-b-idea-description-1`（idea-b-one；默认A4）
- S4 `round-b-idea-description-2`（idea-b-two；默认A4）
- S4 `round-b-idea-description-3`（idea-b-three；默认A4）
- S5 `prototype-single-confirmed-text`（prototype-single；默认A4）
- S5 `prototype-single-verification-question`（prototype-single；默认A4）
- S5 `prototype-three-confirmed-text`（prototype-three；默认A4）
- S5 `prototype-three-verification-question`（prototype-three；默认A4）
- S5 `prototype-single-image`（prototype-single；默认A4）
- S5 `prototype-three-image`（prototype-three；默认A4）
- S5 `prototype-three-html`（prototype-three；默认A4）
- S5 `prototype-three-webapp`（prototype-three；默认A4）
- S6 `offline-test-learning-record`（test-offline；默认A4）
- S6 `offline-asr-report`（test-offline；默认A4）
- S6 `survey-test-learning-record`（test-survey；默认A4）
- S6 `survey-native-questionnaire`（test-survey；默认A4）
- S6 `survey-native-response-report`（test-survey；默认A4）
- S6 `virtual-test-learning-record`（test-virtual；默认A4）
- S6 `virtual-native-outline`（test-virtual；默认A4）
- S6 `virtual-native-runs`（test-virtual；默认A4）
- S6 `virtual-native-report`（test-virtual；默认A4）
- S6 `iteration-prototype`（test-offline；默认A4）
- S6 `confirmed-group-report`（group-report；默认A4）

---
## N0. 本轮唯一执行顺序与事实边界

1. 当前全部新增能力与确证缺陷收敛到**同一精确候选、同一整合PR**，完成独立review和必须的受保护CI；不代审批，不绕门禁。
2. 精确候选通过上述检查后只走既有发布线**一次Dev安装**，核source/manifest/imageTag/install/runtime配对；不得以旧镜像/health200替代版本。
3. 安装后由root独立QA用**一个普通成员、同一主项目**完整执行本轮新E2E；方法/单选与3选/三测试路径用同项目独立实体，证据不跨项目拼接。需要隔离/并发反例时仅用已有授权fixture/身份，缺失即标待准备，不擅自开户/改角色。
4. 所有新项通过才可汇总本轮通过范围；失败保留原证据并回原lane修，不把后续补丁或局部结果冒称此前通过。**本轮无CN发布**。不再要求完整新E2E先于首次Dev安装。
5. 本次仅生成文档replacement/diff；无CI/Dev/账户/模型/运行操作。旧基线D=`9606ea425317db678190b5cac88ac744cb22a319`的live **0/8**、旧native **14/15有失败**按各自旧源/控制留档，不混入本轮112案分子；旧native44982968956的source/control均D，照片控制K=`8f76b25390c4a3959f0c579a78b674adb6bf990c`不能倒填该run。新整合应用/最终控制尚待冻结。

### 入口优先检查 ENTRY-01（H01 的本轮普通成员创建子场景）

先执行此项，再做以下112项专项与分支。不提前删除本次项目，不以管理员或预建完成状态替代。

1. 以当前获准的普通成员，从正常项目列表进入 AIDT 创建入口，仅创建一个明确标记为软件 QA 的合成项目。
2. 返回正常列表并刷新，核对同一项目仍可见；重新打开同一项目，核对项目身份与全屏六步总览完整。
3. 留下精确应用/控制版本、实际组织角色、专用项目标识、创建回执、刷新后列表与重开六步的脱敏截图；保留同一项目给后续步骤。失败记录第一断言、实际请求/提示及时间，不重建项目来掩盖失败。
4. 时限8分钟。无获准身份、同版运行或正常入口即记BLOCKED；局部React夹具只能算探索，不可给本项标通过。

状态：**NOT_RUN**。环境/版本：________；检查点/失败位置：________；证据/截图：________。Dev精确安装后优先执行，不等待112项自动执行器全部接齐。

## N1. 已确认最新范围（不能倒称旧源码已实现）

| 阶段/范围 | 本轮正式验收目标 |
|---|---|
| S1 | 学生原命题/价值/来源先输入，真实追问→学生回应取舍→改写→明确确认保存；每阶段按需AI候选均不自动共享保存或越权。 |
| S2 | 访谈/观察及有材料的人物发现卡；同访谈AI归纳候选→选择编辑→正常保存。#6962的S2出现画像/HMW入口是待复现报告，不能先认根因/迁移删除；当前可核业务类型仅interview，观察来源与独立实体待核。 |
| S3 | persona与HMW两类正式产出，各自按需1/多候选、学生选择编辑确认并打印；追溯授权访谈/观察与本组研讨。persona使用真实后台模板，不限定8候选/8张/8页，选1主动正式入表。 |
| S4 | 学生明确选择已确认HMW；主场次至少两轮真实Chat迭代；六方法显式选择并分别正常工作；Ideas列表、≥3不同完整描述单/分类/审阅/正式完成，冻结来源交接。六方法是否各两轮必须在发送manifest明确，不能用主场次两轮冒认全部。 |
| S5 | 同项目独立原型验证单选idea与3选idea；逐idea追溯S1–S4。正式文字方案/验证问题先保存为可回读版本并明确确认，再生成图片、HTML、WebApp并核真实产物/版本。旧D的1–2来源及旧V2静态优先不能免验新3选/交互类型。 |
| S6 | 每测试实体绑定正式原型精确version；①线下告知/同意→主动音频→真实ASR→校对/报告，②Survey明确测试→UI发布→UI填写提交→真实答卷绑定，③既有User Research大纲→标模拟对话→具体功能反馈/需求→实际原段回链。模拟始终模拟，不冒充真人效果。三路径各自认识变化/返回行动和来源进入报告。 |
| 全实体 | 每种实际可建实体的新建/编辑/删除弹窗、取消确认、校验/标签、权限、刷新/删除后列表；只专用数据，不把报告固定列表/PDF/方法虚构为另一可建实体。 |
| 全正式产出+报告 | 每产出先用户可见分页预览→明确打印→真系统打印对话→实际保存A4/A3/A1 PDF并独立解析/逐页渲染。persona/画布默认A1且无固定纸页数；其它按内容合理A4/A3默认，仍可三选。对话打开/print事件不等于PDF已保存。 |

## N2. 进入独立完整E2E前的控制闭合表（NOT_RUN）

原44教学turn、16PDF及263写cap保持原义；本轮新增不能靠删旧文件、换账本、无限上调或旧成绩覆盖。必须由发布/控制负责人提供**精确匹配新控制器及闭合计划**，独审后以一次受控执行消耗；本文件不批准新次数、权限或费用。

| 控制项 | 需闭合的具体内容 | 当前 |
|---|---|---|
| TURN-PLAN | 逐case/实体/方法列真实逻辑发送与最大physical尝试；主场次两轮、六方法、S5三类型及Research模拟分别列明，正常UI人工审阅如何续同run也列入。若总计划能留44内写出分配；若超出，给出有界新上限与独立审阅，不自动扩大。 | 待匹配新控制器及闭合计划；NOT_RUN |
| PDF-PLAN | 每实际正式产物×三纸型的唯一产物名/来源revision、capture方式、系统对话与实际PDF回执、独立尺寸/分页检查；最小仅3点子×3=9+persona/HMW×3=6+报告×3=3已18>旧16，尚未含其它阶段。不可用旧16文件冒充覆盖。 | 旧16不足完整新范围；需有界名单/精确新guard；NOT_RUN |
| WRITE-PLAN | 枚举单选/3选原型、六方法/Ideas、三测试路径、CRUD每实体和显式保存/确认的有限写操作，逐次核263剩余；不另建项目/反复重跑重置。 | 未闭合不得正式开跑；NOT_RUN |
| AUDIO-ASR | 列线下告知/同意、音频/转写处理、原件保存/删除与撤权权限；服务可用及格式/容量/时长有界，不能伪造录音/预制转写。 | 实现与既有授权/控制核对待完成；NOT_RUN |
| SURVEY-RESEARCH | 正常发布/填答允许范围、模拟对话次数和真实模型调用及功能反馈/需求原段来源；不API预写完成。 | 待完整计划；NOT_RUN |
| ACTOR-ENV | 普通成员身份与同项目、精确应用/控制/source/manifest/install/runtime、一套在途负责人；不猜最终控制，不重复Dev。 | 未冻结/未执行；NOT_RUN |

单案时限见各案。到时先记录checkpoint/具体请求/日志与未知写结果，只读回查并交原lane；不自动重试、加时或调宽断言。各参数实例须在事先冻结总计划中逐一有界计时，不能无限展开。未完成案保持NOT_RUN/阻塞，不冒充失败已修或通过。

## N3. 本轮登记、实际回执与证据命名

| 字段 | 本次实际填写（当前留空） |
|---|---|
| applicationSHA / PR / review / CI | __________________；NOT_RUN |
| imageTag / manifest / install / runtime | __________________；NOT_RUN |
| 最终controllerSHA / 控制名单hash / 唯一run | __________________；NOT_RUN |
| 普通角色/主projectId/浏览器系统与尺寸 | __________________；NOT_RUN |
| 真实Agent/provider与无替身说明 | __________________；NOT_RUN |
| 允许材料/同意/模板id+version/Survey答卷/Research来源 | __________________；NOT_RUN |
| 原44turn/16PDF/263写guard闭合批准引用 | __________________；NOT_RUN |
| 通过/失败/NOT_RUN与缺陷、截图及实际PDF索引 | __________________；NOT_RUN |

所有下列截图名是**拟交付文件名**，当前没有截图/PDF文件，不可当证据。每案记录来源版本、entity/thread/run，截图不含凭据/真实个人信息。实际PDF按`V2N-<case>-<entity>-<paper>-<revision>.pdf`唯一命名，另有sha256/MediaBox/CropBox/页数与逐页渲染。合成材料明标合成；Research模拟明标模拟；真实模型不代表真实人类研究已经发生。

## N4. 全部112案待执行详细卡

状态均为NOT_RUN；前置不满足就写具体缺项，不能用管理员/回环/其它项目替代。每案“判定”是未来期望，实际结果与证据均留空。全实体参数化案必须对最终实际可建实体逐一登记，不把1次操作计所有类型通过。


### 范围：S1

#### AI-S1-01 · 按需入口与学生先输入

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 已进入正常创建的主项目，当前命题实体和原始学生输入可定位。
- **具体操作**：首次进入/切换实体/刷新，未点整理；先手填本步要求的初稿，再主动点入口。
- **判定**：无自动模型调用/隐藏触发；手填入口始终可用；提示够具体但不代填学生首次思考。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S1-01-01-before.png`；`V2N-AI-S1-01-02-result.png`；`V2N-AI-S1-01-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S1 I1–I4/O1–O3；V2:65–155；FR15；SRC02:261–283；SRC14:15–29；SRC20:81–95；SRC13:17–22。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S1-02 · 授权上下文与精确范围

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 已进入正常创建的主项目，当前命题实体和原始学生输入可定位。
- **具体操作**：用本项目合成A/B实体及另一无权项目作对照，检查候选来源回执而不读取无权内容。
- **判定**：只使用本步声明范围和精确版本；同项目也不等于能读所有私聊/受访者/历史；无权材料不泄露标题或内容。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S1-02-01-before.png`；`V2N-AI-S1-02-02-result.png`；`V2N-AI-S1-02-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S1 I1–I4/O1–O3；V2:65–155；FR15；SRC02:261–283；SRC14:15–29；SRC20:81–95；SRC13:17–22。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S1-03 · 缺证据/加载/生成失败

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 已进入正常创建的主项目，当前命题实体和原始学生输入可定位。
- **具体操作**：缺本步必要学生初稿、空材料；再触发加载失败、权限变化、超时/工具错误。
- **判定**：明确缺项/处理中/失败可重试；保留手工草稿，不能说成功或补造；不盲目重放未知写入。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S1-03-01-before.png`；`V2N-AI-S1-03-02-result.png`；`V2N-AI-S1-03-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤15分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S1 I1–I4/O1–O3；V2:65–155；FR15；SRC02:261–283；SRC14:15–29；SRC20:81–95；SRC13:17–22。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S1-04 · 单/多候选与取消

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 已进入正常创建的主项目，当前命题实体和原始学生输入可定位。
- **具体操作**：分别获得证据支持的单/多候选；比较预览、切换、返回/取消。
- **判定**：候选标AI草稿/来源/未知；可正常预览/选/取消；未选者不入正式表，不固定凑数。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S1-04-01-before.png`；`V2N-AI-S1-04-02-result.png`；`V2N-AI-S1-04-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S1 I1–I4/O1–O3；V2:65–155；FR15；SRC02:261–283；SRC14:15–29；SRC20:81–95；SRC13:17–22。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S1-05 · 编辑和已有稿冲突

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 已进入正常创建的主项目，当前命题实体和原始学生输入可定位。
- **具体操作**：原来有学生稿，选择候选并手工修改；再取消或切实体。
- **判定**：明确替换/保留选择，不能静默覆写；编辑局部绑定当前实体，不能串到兄弟卡；刷新后符合实际保存边界。 六步均要求AI候选预览/选择/编辑不自动共享保存；要落正式产物须明确应用并按正常保存/确认协议完成。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S1-05-01-before.png`；`V2N-AI-S1-05-02-result.png`；`V2N-AI-S1-05-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S1 I1–I4/O1–O3；V2:65–155；FR15；SRC02:261–283；SRC14:15–29；SRC20:81–95；SRC13:17–22。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S1-06 · 明确应用/防重复/失败重试

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 已进入正常创建的主项目，当前命题实体和原始学生输入可定位。
- **具体操作**：先记录服务端revision；候选预览/选择/编辑时不点应用/保存并核无共享写入，再确认目标后点实际应用/正常保存；双击、返回重进及受控失败后重试。
- **判定**：准确显示应用到哪一产物；仅一次正式写入/实体，不因重复点击造重复；失败不假成功，未知结果先回读。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S1-06-01-before.png`；`V2N-AI-S1-06-02-result.png`；`V2N-AI-S1-06-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S1 I1–I4/O1–O3；V2:65–155；FR15；SRC02:261–283；SRC14:15–29；SRC20:81–95；SRC13:17–22。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S1-07 · 保存/完成/刷新交接

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 已进入正常创建的主项目，当前命题实体和原始学生输入可定位。
- **具体操作**：应用候选为草稿→回总览刷新；补齐原必需输入再从正常UI确认→刷新→下一阶段。
- **判定**：候选/保存≠阶段完成；原门槛保留；完成标记和精确revision服务端回读，下一阶段冻结同版本来源。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S1-07-01-before.png`；`V2N-AI-S1-07-02-result.png`；`V2N-AI-S1-07-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S1 I1–I4/O1–O3；V2:65–155；FR15；SRC02:261–283；SRC14:15–29；SRC20:81–95；SRC13:17–22。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S1-08 · 权限/撤权/旧候选失效

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 已进入正常创建的主项目，当前命题实体和原始学生输入可定位。
- **具体操作**：生成时撤回来源权限或变只读，再尝试应用；恢复合法范围后重新核对。
- **判定**：重新校验当前访问与材料授权；过期结果不落正式成果，不用缓存泄露；恢复不自动重发/确认。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S1-08-01-before.png`；`V2N-AI-S1-08-02-result.png`；`V2N-AI-S1-08-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S1 I1–I4/O1–O3；V2:65–155；FR15；SRC02:261–283；SRC14:15–29；SRC20:81–95；SRC13:17–22。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S1-09 · 可用性/键盘/移动端

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 已进入正常创建的主项目，当前命题实体和原始学生输入可定位。
- **具体操作**：正常键盘Tab/Enter/IME/Esc、375px及桌面浏览预览/选择/取消/保存。
- **判定**：入口可辨认、焦点可达并回到触发点，加载/错误可理解；无遮挡横溢；不force隐藏控件。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S1-09-01-before.png`；`V2N-AI-S1-09-02-result.png`；`V2N-AI-S1-09-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S1 I1–I4/O1–O3；V2:65–155；FR15；SRC02:261–283；SRC14:15–29；SRC20:81–95；SRC13:17–22。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S1-10 · 价值与来源先行

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 已进入正常创建的主项目，当前命题实体和原始学生输入可定位。
- **具体操作**：只输入“改善校园体验”后点整理；再补“猜测”、价值和不确定项。
- **判定**：先指出缺项/追问；不得代填学生理由、称问题已证实或直接给App方案。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S1-10-01-before.png`；`V2N-AI-S1-10-02-result.png`；`V2N-AI-S1-10-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S1 I1–I4/O1–O3；V2:65–155；FR15；SRC02:261–283；SRC14:15–29；SRC20:81–95；SRC13:17–22。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S1-11 · 回应实际追问再改写

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 已进入正常创建的主项目，当前命题实体和原始学生输入可定位。
- **具体操作**：展示本次真实教学反馈，学生说明采纳/不采纳及方向，再编辑/保存研究主题。
- **判定**：必须能追溯该次反馈和学生回应；固定夹具第二段、AI自己写的回答不能冒充学生取舍。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S1-11-01-before.png`；`V2N-AI-S1-11-02-result.png`；`V2N-AI-S1-11-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S1 I1–I4/O1–O3；V2:65–155；FR15；SRC02:261–283；SRC14:15–29；SRC20:81–95；SRC13:17–22。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S1-12 · 确认与交接

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 已进入正常创建的主项目，当前命题实体和原始学生输入可定位。
- **具体操作**：候选应用为草稿时回总览；明确确认后刷新，再进入S2。
- **判定**：草稿未完成；确认状态/主题/反思对应精确保存revision；S2引用同revision。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S1-12-01-before.png`；`V2N-AI-S1-12-02-result.png`；`V2N-AI-S1-12-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S1 I1–I4/O1–O3；V2:65–155；FR15；SRC02:261–283；SRC14:15–29；SRC20:81–95；SRC13:17–22。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。


### 范围：S2

#### AI-S2-01 · 按需入口与学生先输入

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第1步确认主题/反思有精确版本；当前访谈/观察来源与所需授权可核；观察是否独立实体不得假定。
- **具体操作**：首次进入/切换实体/刷新，未点整理；先手填本步要求的初稿，再主动点入口。
- **判定**：无自动模型调用/隐藏触发；手填入口始终可用；提示够具体但不代填学生首次思考。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S2-01-01-before.png`；`V2N-AI-S2-01-02-result.png`；`V2N-AI-S2-01-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S2 I1–I3/O1–O3；V2:157–235；#6958；SRC07:34–44,58–122；SRC08:39–51；SRC32:264–303；SRC34:244–250；SRC20:94–101；SRC23:照片撤权控制分支。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S2-02 · 授权上下文与精确范围

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第1步确认主题/反思有精确版本；当前访谈/观察来源与所需授权可核；观察是否独立实体不得假定。
- **具体操作**：用本项目合成A/B实体及另一无权项目作对照，检查候选来源回执而不读取无权内容。
- **判定**：只使用本步声明范围和精确版本；同项目也不等于能读所有私聊/受访者/历史；无权材料不泄露标题或内容。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S2-02-01-before.png`；`V2N-AI-S2-02-02-result.png`；`V2N-AI-S2-02-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S2 I1–I3/O1–O3；V2:157–235；#6958；SRC07:34–44,58–122；SRC08:39–51；SRC32:264–303；SRC34:244–250；SRC20:94–101；SRC23:照片撤权控制分支。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S2-03 · 缺证据/加载/生成失败

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第1步确认主题/反思有精确版本；当前访谈/观察来源与所需授权可核；观察是否独立实体不得假定。
- **具体操作**：缺本步必要学生初稿、空材料；再触发加载失败、权限变化、超时/工具错误。
- **判定**：明确缺项/处理中/失败可重试；保留手工草稿，不能说成功或补造；不盲目重放未知写入。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S2-03-01-before.png`；`V2N-AI-S2-03-02-result.png`；`V2N-AI-S2-03-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤15分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S2 I1–I3/O1–O3；V2:157–235；#6958；SRC07:34–44,58–122；SRC08:39–51；SRC32:264–303；SRC34:244–250；SRC20:94–101；SRC23:照片撤权控制分支。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S2-04 · 单/多候选与取消

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第1步确认主题/反思有精确版本；当前访谈/观察来源与所需授权可核；观察是否独立实体不得假定。
- **具体操作**：分别获得证据支持的单/多候选；比较预览、切换、返回/取消。
- **判定**：候选标AI草稿/来源/未知；可正常预览/选/取消；未选者不入正式表，不固定凑数。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S2-04-01-before.png`；`V2N-AI-S2-04-02-result.png`；`V2N-AI-S2-04-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S2 I1–I3/O1–O3；V2:157–235；#6958；SRC07:34–44,58–122；SRC08:39–51；SRC32:264–303；SRC34:244–250；SRC20:94–101；SRC23:照片撤权控制分支。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S2-05 · 编辑和已有稿冲突

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第1步确认主题/反思有精确版本；当前访谈/观察来源与所需授权可核；观察是否独立实体不得假定。
- **具体操作**：原来有学生稿，选择候选并手工修改；再取消或切实体。
- **判定**：明确替换/保留选择，不能静默覆写；编辑局部绑定当前实体，不能串到兄弟卡；刷新后符合实际保存边界。 六步均要求AI候选预览/选择/编辑不自动共享保存；要落正式产物须明确应用并按正常保存/确认协议完成。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S2-05-01-before.png`；`V2N-AI-S2-05-02-result.png`；`V2N-AI-S2-05-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S2 I1–I3/O1–O3；V2:157–235；#6958；SRC07:34–44,58–122；SRC08:39–51；SRC32:264–303；SRC34:244–250；SRC20:94–101；SRC23:照片撤权控制分支。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S2-06 · 明确应用/防重复/失败重试

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第1步确认主题/反思有精确版本；当前访谈/观察来源与所需授权可核；观察是否独立实体不得假定。
- **具体操作**：先记录服务端revision；候选预览/选择/编辑时不点应用/保存并核无共享写入，再确认目标后点实际应用/正常保存；双击、返回重进及受控失败后重试。
- **判定**：准确显示应用到哪一产物；仅一次正式写入/实体，不因重复点击造重复；失败不假成功，未知结果先回读。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S2-06-01-before.png`；`V2N-AI-S2-06-02-result.png`；`V2N-AI-S2-06-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S2 I1–I3/O1–O3；V2:157–235；#6958；SRC07:34–44,58–122；SRC08:39–51；SRC32:264–303；SRC34:244–250；SRC20:94–101；SRC23:照片撤权控制分支。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S2-07 · 保存/完成/刷新交接

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第1步确认主题/反思有精确版本；当前访谈/观察来源与所需授权可核；观察是否独立实体不得假定。
- **具体操作**：应用候选为草稿→回总览刷新；补齐原必需输入再从正常UI确认→刷新→下一阶段。
- **判定**：候选/保存≠阶段完成；原门槛保留；完成标记和精确revision服务端回读，下一阶段冻结同版本来源。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S2-07-01-before.png`；`V2N-AI-S2-07-02-result.png`；`V2N-AI-S2-07-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S2 I1–I3/O1–O3；V2:157–235；#6958；SRC07:34–44,58–122；SRC08:39–51；SRC32:264–303；SRC34:244–250；SRC20:94–101；SRC23:照片撤权控制分支。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S2-08 · 权限/撤权/旧候选失效

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第1步确认主题/反思有精确版本；当前访谈/观察来源与所需授权可核；观察是否独立实体不得假定。
- **具体操作**：生成时撤回来源权限或变只读，再尝试应用；恢复合法范围后重新核对。
- **判定**：重新校验当前访问与材料授权；过期结果不落正式成果，不用缓存泄露；恢复不自动重发/确认。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S2-08-01-before.png`；`V2N-AI-S2-08-02-result.png`；`V2N-AI-S2-08-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S2 I1–I3/O1–O3；V2:157–235；#6958；SRC07:34–44,58–122；SRC08:39–51；SRC32:264–303；SRC34:244–250；SRC20:94–101；SRC23:照片撤权控制分支。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S2-09 · 可用性/键盘/移动端

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第1步确认主题/反思有精确版本；当前访谈/观察来源与所需授权可核；观察是否独立实体不得假定。
- **具体操作**：正常键盘Tab/Enter/IME/Esc、375px及桌面浏览预览/选择/取消/保存。
- **判定**：入口可辨认、焦点可达并回到触发点，加载/错误可理解；无遮挡横溢；不force隐藏控件。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S2-09-01-before.png`；`V2N-AI-S2-09-02-result.png`；`V2N-AI-S2-09-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S2 I1–I3/O1–O3；V2:157–235；#6958；SRC07:34–44,58–122；SRC08:39–51；SRC32:264–303；SRC34:244–250；SRC20:94–101；SRC23:照片撤权控制分支。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S2-10 · 候选不得自动保存

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第1步确认主题/反思有精确版本；当前访谈/观察来源与所需授权可核；观察是否独立实体不得假定。
- **具体操作**：记录服务端stage revision/原发现卡；生成、预览、选择候选、编辑但尚未点正常保存，随后刷新/取消。
- **判定**：生成可有独立运行审计；正式发现卡/共享stage不得因候选选择而自动变更。已有手填内容不得静默覆盖；取消可返回原稿。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S2-10-01-before.png`；`V2N-AI-S2-10-02-result.png`；`V2N-AI-S2-10-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S2 I1–I3/O1–O3；V2:157–235；#6958；SRC07:34–44,58–122；SRC08:39–51；SRC32:264–303；SRC34:244–250；SRC20:94–101；SRC23:照片撤权控制分支。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S2-11 · 引文与AI表达分离

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第1步确认主题/反思有精确版本；当前访谈/观察来源与所需授权可核；观察是否独立实体不得假定。
- **具体操作**：用仅有一句泛泛喜好的授权访谈；比较AI摘要、真实quote、学生解释。
- **判定**：没有材料不臆测“怕踩雷”；摘要标AI草稿/学生概括，不加假引号，不把AI推测当证据。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S2-11-01-before.png`；`V2N-AI-S2-11-02-result.png`；`V2N-AI-S2-11-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S2 I1–I3/O1–O3；V2:157–235；#6958；SRC07:34–44,58–122；SRC08:39–51；SRC32:264–303；SRC34:244–250；SRC20:94–101；SRC23:照片撤权控制分支。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S2-12 · 撤权与候选竞态

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第1步确认主题/反思有精确版本；当前访谈/观察来源与所需授权可核；观察是否独立实体不得假定。
- **具体操作**：同一授权访谈生成中撤回文字或照片授权；完成后尝试预览/应用；另一个受访者保持授权。
- **判定**：服务端重新核范围；过期候选不落入正式产物，当前和冻结历史的受保护图不显示；原文字/已合法材料保留依实际授权；兄弟卡不串图。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S2-12-01-before.png`；`V2N-AI-S2-12-02-result.png`；`V2N-AI-S2-12-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S2 I1–I3/O1–O3；V2:157–235；#6958；SRC07:34–44,58–122；SRC08:39–51；SRC32:264–303；SRC34:244–250；SRC20:94–101；SRC23:照片撤权控制分支。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S2-13 · 提纲卡不充发现卡

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第1步确认主题/反思有精确版本；当前访谈/观察来源与所需授权可核；观察是否独立实体不得假定。
- **具体操作**：有多名活跃受访者，部分只有提纲，一名有确认发现；回总览。
- **判定**：不把提纲数量当完成卡数；不按10人夹具强制V2人数；全部适用受访者完成后再显示正常S3交接。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S2-13-01-before.png`；`V2N-AI-S2-13-02-result.png`；`V2N-AI-S2-13-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S2 I1–I3/O1–O3；V2:157–235；#6958；SRC07:34–44,58–122；SRC08:39–51；SRC32:264–303；SRC34:244–250；SRC20:94–101；SRC23:照片撤权控制分支。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。


### 范围：S3

#### AI-S3-01 · 按需入口与学生先输入

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第2步实际材料/发现卡保存可回读，意外发现或暂无已填写；persona/HMW入口来源精确。
- **具体操作**：首次进入/切换实体/刷新，未点整理；先手填本步要求的初稿，再主动点入口。
- **判定**：无自动模型调用/隐藏触发；手填入口始终可用；提示够具体但不代填学生首次思考。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S3-01-01-before.png`；`V2N-AI-S3-01-02-result.png`；`V2N-AI-S3-01-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S3 I1–I4/O1–O4；V2:237–339；FR16；#6959/#6960；用户最新明确persona＋HMW双正式产物范围；SRC06:151–193,313–390；SRC14:47–61；SRC24:140–141；SRC27:49–55；SRC38:14–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S3-02 · 授权上下文与精确范围

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第2步实际材料/发现卡保存可回读，意外发现或暂无已填写；persona/HMW入口来源精确。
- **具体操作**：用本项目合成A/B实体及另一无权项目作对照，检查候选来源回执而不读取无权内容。
- **判定**：只使用本步声明范围和精确版本；同项目也不等于能读所有私聊/受访者/历史；无权材料不泄露标题或内容。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S3-02-01-before.png`；`V2N-AI-S3-02-02-result.png`；`V2N-AI-S3-02-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S3 I1–I4/O1–O4；V2:237–339；FR16；#6959/#6960；用户最新明确persona＋HMW双正式产物范围；SRC06:151–193,313–390；SRC14:47–61；SRC24:140–141；SRC27:49–55；SRC38:14–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S3-03 · 缺证据/加载/生成失败

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第2步实际材料/发现卡保存可回读，意外发现或暂无已填写；persona/HMW入口来源精确。
- **具体操作**：缺本步必要学生初稿、空材料；再触发加载失败、权限变化、超时/工具错误。
- **判定**：明确缺项/处理中/失败可重试；保留手工草稿，不能说成功或补造；不盲目重放未知写入。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S3-03-01-before.png`；`V2N-AI-S3-03-02-result.png`；`V2N-AI-S3-03-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤15分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S3 I1–I4/O1–O4；V2:237–339；FR16；#6959/#6960；用户最新明确persona＋HMW双正式产物范围；SRC06:151–193,313–390；SRC14:47–61；SRC24:140–141；SRC27:49–55；SRC38:14–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S3-04 · 单/多候选与取消

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第2步实际材料/发现卡保存可回读，意外发现或暂无已填写；persona/HMW入口来源精确。
- **具体操作**：分别获得证据支持的单/多候选；比较预览、切换、返回/取消。
- **判定**：候选标AI草稿/来源/未知；可正常预览/选/取消；未选者不入正式表，不固定凑数。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S3-04-01-before.png`；`V2N-AI-S3-04-02-result.png`；`V2N-AI-S3-04-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S3 I1–I4/O1–O4；V2:237–339；FR16；#6959/#6960；用户最新明确persona＋HMW双正式产物范围；SRC06:151–193,313–390；SRC14:47–61；SRC24:140–141；SRC27:49–55；SRC38:14–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S3-05 · 编辑和已有稿冲突

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第2步实际材料/发现卡保存可回读，意外发现或暂无已填写；persona/HMW入口来源精确。
- **具体操作**：原来有学生稿，选择候选并手工修改；再取消或切实体。
- **判定**：明确替换/保留选择，不能静默覆写；编辑局部绑定当前实体，不能串到兄弟卡；刷新后符合实际保存边界。 六步均要求AI候选预览/选择/编辑不自动共享保存；要落正式产物须明确应用并按正常保存/确认协议完成。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S3-05-01-before.png`；`V2N-AI-S3-05-02-result.png`；`V2N-AI-S3-05-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S3 I1–I4/O1–O4；V2:237–339；FR16；#6959/#6960；用户最新明确persona＋HMW双正式产物范围；SRC06:151–193,313–390；SRC14:47–61；SRC24:140–141；SRC27:49–55；SRC38:14–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S3-06 · 明确应用/防重复/失败重试

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第2步实际材料/发现卡保存可回读，意外发现或暂无已填写；persona/HMW入口来源精确。
- **具体操作**：先记录服务端revision；候选预览/选择/编辑时不点应用/保存并核无共享写入，再确认目标后点实际应用/正常保存；双击、返回重进及受控失败后重试。
- **判定**：准确显示应用到哪一产物；仅一次正式写入/实体，不因重复点击造重复；失败不假成功，未知结果先回读。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S3-06-01-before.png`；`V2N-AI-S3-06-02-result.png`；`V2N-AI-S3-06-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S3 I1–I4/O1–O4；V2:237–339；FR16；#6959/#6960；用户最新明确persona＋HMW双正式产物范围；SRC06:151–193,313–390；SRC14:47–61；SRC24:140–141；SRC27:49–55；SRC38:14–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S3-07 · 保存/完成/刷新交接

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第2步实际材料/发现卡保存可回读，意外发现或暂无已填写；persona/HMW入口来源精确。
- **具体操作**：应用候选为草稿→回总览刷新；补齐原必需输入再从正常UI确认→刷新→下一阶段。
- **判定**：候选/保存≠阶段完成；原门槛保留；完成标记和精确revision服务端回读，下一阶段冻结同版本来源。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S3-07-01-before.png`；`V2N-AI-S3-07-02-result.png`；`V2N-AI-S3-07-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S3 I1–I4/O1–O4；V2:237–339；FR16；#6959/#6960；用户最新明确persona＋HMW双正式产物范围；SRC06:151–193,313–390；SRC14:47–61；SRC24:140–141；SRC27:49–55；SRC38:14–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S3-08 · 权限/撤权/旧候选失效

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第2步实际材料/发现卡保存可回读，意外发现或暂无已填写；persona/HMW入口来源精确。
- **具体操作**：生成时撤回来源权限或变只读，再尝试应用；恢复合法范围后重新核对。
- **判定**：重新校验当前访问与材料授权；过期结果不落正式成果，不用缓存泄露；恢复不自动重发/确认。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S3-08-01-before.png`；`V2N-AI-S3-08-02-result.png`；`V2N-AI-S3-08-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S3 I1–I4/O1–O4；V2:237–339；FR16；#6959/#6960；用户最新明确persona＋HMW双正式产物范围；SRC06:151–193,313–390；SRC14:47–61；SRC24:140–141；SRC27:49–55；SRC38:14–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S3-09 · 可用性/键盘/移动端

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第2步实际材料/发现卡保存可回读，意外发现或暂无已填写；persona/HMW入口来源精确。
- **具体操作**：正常键盘Tab/Enter/IME/Esc、375px及桌面浏览预览/选择/取消/保存。
- **判定**：入口可辨认、焦点可达并回到触发点，加载/错误可理解；无遮挡横溢；不force隐藏控件。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S3-09-01-before.png`；`V2N-AI-S3-09-02-result.png`；`V2N-AI-S3-09-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S3 I1–I4/O1–O4；V2:237–339；FR16；#6959/#6960；用户最新明确persona＋HMW双正式产物范围；SRC06:151–193,313–390；SRC14:47–61；SRC24:140–141；SRC27:49–55；SRC38:14–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S3-10 · 真实后台模板而非替代卡

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第2步实际材料/发现卡保存可回读，意外发现或暂无已填写；persona/HMW入口来源精确。
- **具体操作**：记录实际授权后台templateId/key/version/发布状态，打开每个候选真实画布并与该版本模板比较。
- **判定**：使用真实persona模板；候选内容覆盖该模板实际全部字段/分区/画布，不以纯文字卡或空模板替代。D内置定义key=persona有9表头/6分区，仅是源码基线，不代表Dev有效配置。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S3-10-01-before.png`；`V2N-AI-S3-10-02-result.png`；`V2N-AI-S3-10-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S3 I1–I4/O1–O4；V2:237–339；FR16；#6959/#6960；用户最新明确persona＋HMW双正式产物范围；SRC06:151–193,313–390；SRC14:47–61；SRC24:140–141；SRC27:49–55；SRC38:14–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S3-11 · 候选数量纠正

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第2步实际材料/发现卡保存可回读，意外发现或暂无已填写；persona/HMW入口来源精确。
- **具体操作**：分别以足够支持一个和多个方向的合成材料触发；逐一预览，取消后再选1个。
- **判定**：不固定8、不为了版面凑数、不固定页/纸张数；只有主动选中并应用的1个进入正式表；取消/未选不进表。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S3-11-01-before.png`；`V2N-AI-S3-11-02-result.png`；`V2N-AI-S3-11-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S3 I1–I4/O1–O4；V2:237–339；FR16；#6959/#6960；用户最新明确persona＋HMW双正式产物范围；SRC06:151–193,313–390；SRC14:47–61；SRC24:140–141；SRC27:49–55；SRC38:14–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S3-12 · 暂无与例外

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第2步实际材料/发现卡保存可回读，意外发现或暂无已填写；persona/HMW入口来源精确。
- **具体操作**：意外发现先填“暂无”，再另轮记录有材料的矛盾/例外。
- **判定**：暂无正常继续且不强制补访；有发现缺引用可草稿不冒充已核；画像不能抹去少数差异、补造年龄/心理。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S3-12-01-before.png`；`V2N-AI-S3-12-02-result.png`；`V2N-AI-S3-12-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S3 I1–I4/O1–O4；V2:237–339；FR16；#6959/#6960；用户最新明确persona＋HMW双正式产物范围；SRC06:151–193,313–390；SRC14:47–61；SRC24:140–141；SRC27:49–55；SRC38:14–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S3-13 · HMW按需候选与学生选择

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第2步实际材料/发现卡保存可回读，意外发现或暂无已填写；persona/HMW入口来源精确。
- **具体操作**：在同一S3项目基于授权访谈/观察和本组研讨，先保留学生HMW初稿，再主动请求一个或多个候选；逐一预览，选择、取消并手工编辑。
- **判定**：HMW与persona都是正式输出类型；候选不自动入正式成果、不替学生选择，取消保留原稿。保留既有教师引导/学生判断；仅增加用户明确的按需候选闭环，不加额外专属向导或强制作业。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S3-13-01-before.png`；`V2N-AI-S3-13-02-result.png`；`V2N-AI-S3-13-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S3 I1–I4/O1–O4；V2:237–339；FR16；#6959/#6960；用户最新明确persona＋HMW双正式产物范围；SRC06:151–193,313–390；SRC14:47–61；SRC24:140–141；SRC27:49–55；SRC38:14–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。


### 范围：S4

#### AI-S4-01 · 按需入口与学生先输入

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第3步学生选定已确认HMW有精确ID/text/revision，当前场次/idea实体合法。
- **具体操作**：首次进入/切换实体/刷新，未点整理；先手填本步要求的初稿，再主动点入口。
- **判定**：无自动模型调用/隐藏触发；手填入口始终可用；提示够具体但不代填学生首次思考。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S4-01-01-before.png`；`V2N-AI-S4-01-02-result.png`；`V2N-AI-S4-01-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S4 I1–I4/O1–O4；V2:341–443；FR07/FR17；SRC29:31–153；SRC11；SRC35；SRC13:40–46；SRC14:64–79。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S4-02 · 授权上下文与精确范围

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第3步学生选定已确认HMW有精确ID/text/revision，当前场次/idea实体合法。
- **具体操作**：用本项目合成A/B实体及另一无权项目作对照，检查候选来源回执而不读取无权内容。
- **判定**：只使用本步声明范围和精确版本；同项目也不等于能读所有私聊/受访者/历史；无权材料不泄露标题或内容。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S4-02-01-before.png`；`V2N-AI-S4-02-02-result.png`；`V2N-AI-S4-02-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S4 I1–I4/O1–O4；V2:341–443；FR07/FR17；SRC29:31–153；SRC11；SRC35；SRC13:40–46；SRC14:64–79。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S4-03 · 缺证据/加载/生成失败

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第3步学生选定已确认HMW有精确ID/text/revision，当前场次/idea实体合法。
- **具体操作**：缺本步必要学生初稿、空材料；再触发加载失败、权限变化、超时/工具错误。
- **判定**：明确缺项/处理中/失败可重试；保留手工草稿，不能说成功或补造；不盲目重放未知写入。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S4-03-01-before.png`；`V2N-AI-S4-03-02-result.png`；`V2N-AI-S4-03-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤15分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S4 I1–I4/O1–O4；V2:341–443；FR07/FR17；SRC29:31–153；SRC11；SRC35；SRC13:40–46；SRC14:64–79。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S4-04 · 单/多候选与取消

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第3步学生选定已确认HMW有精确ID/text/revision，当前场次/idea实体合法。
- **具体操作**：分别获得证据支持的单/多候选；比较预览、切换、返回/取消。
- **判定**：候选标AI草稿/来源/未知；可正常预览/选/取消；未选者不入正式表，不固定凑数。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S4-04-01-before.png`；`V2N-AI-S4-04-02-result.png`；`V2N-AI-S4-04-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S4 I1–I4/O1–O4；V2:341–443；FR07/FR17；SRC29:31–153；SRC11；SRC35；SRC13:40–46；SRC14:64–79。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S4-05 · 编辑和已有稿冲突

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第3步学生选定已确认HMW有精确ID/text/revision，当前场次/idea实体合法。
- **具体操作**：原来有学生稿，选择候选并手工修改；再取消或切实体。
- **判定**：明确替换/保留选择，不能静默覆写；编辑局部绑定当前实体，不能串到兄弟卡；刷新后符合实际保存边界。 六步均要求AI候选预览/选择/编辑不自动共享保存；要落正式产物须明确应用并按正常保存/确认协议完成。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S4-05-01-before.png`；`V2N-AI-S4-05-02-result.png`；`V2N-AI-S4-05-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S4 I1–I4/O1–O4；V2:341–443；FR07/FR17；SRC29:31–153；SRC11；SRC35；SRC13:40–46；SRC14:64–79。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S4-06 · 明确应用/防重复/失败重试

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第3步学生选定已确认HMW有精确ID/text/revision，当前场次/idea实体合法。
- **具体操作**：先记录服务端revision；候选预览/选择/编辑时不点应用/保存并核无共享写入，再确认目标后点实际应用/正常保存；双击、返回重进及受控失败后重试。
- **判定**：准确显示应用到哪一产物；仅一次正式写入/实体，不因重复点击造重复；失败不假成功，未知结果先回读。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S4-06-01-before.png`；`V2N-AI-S4-06-02-result.png`；`V2N-AI-S4-06-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S4 I1–I4/O1–O4；V2:341–443；FR07/FR17；SRC29:31–153；SRC11；SRC35；SRC13:40–46；SRC14:64–79。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S4-07 · 保存/完成/刷新交接

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第3步学生选定已确认HMW有精确ID/text/revision，当前场次/idea实体合法。
- **具体操作**：应用候选为草稿→回总览刷新；补齐原必需输入再从正常UI确认→刷新→下一阶段。
- **判定**：候选/保存≠阶段完成；原门槛保留；完成标记和精确revision服务端回读，下一阶段冻结同版本来源。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S4-07-01-before.png`；`V2N-AI-S4-07-02-result.png`；`V2N-AI-S4-07-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S4 I1–I4/O1–O4；V2:341–443；FR07/FR17；SRC29:31–153；SRC11；SRC35；SRC13:40–46；SRC14:64–79。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S4-08 · 权限/撤权/旧候选失效

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第3步学生选定已确认HMW有精确ID/text/revision，当前场次/idea实体合法。
- **具体操作**：生成时撤回来源权限或变只读，再尝试应用；恢复合法范围后重新核对。
- **判定**：重新校验当前访问与材料授权；过期结果不落正式成果，不用缓存泄露；恢复不自动重发/确认。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S4-08-01-before.png`；`V2N-AI-S4-08-02-result.png`；`V2N-AI-S4-08-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S4 I1–I4/O1–O4；V2:341–443；FR07/FR17；SRC29:31–153；SRC11；SRC35；SRC13:40–46；SRC14:64–79。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S4-09 · 可用性/键盘/移动端

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第3步学生选定已确认HMW有精确ID/text/revision，当前场次/idea实体合法。
- **具体操作**：正常键盘Tab/Enter/IME/Esc、375px及桌面浏览预览/选择/取消/保存。
- **判定**：入口可辨认、焦点可达并回到触发点，加载/错误可理解；无遮挡横溢；不force隐藏控件。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S4-09-01-before.png`；`V2N-AI-S4-09-02-result.png`；`V2N-AI-S4-09-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S4 I1–I4/O1–O4；V2:341–443；FR07/FR17；SRC29:31–153；SRC11；SRC35；SRC13:40–46；SRC14:64–79。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S4-10 · 三份与入选分开

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第3步学生选定已确认HMW有精确ID/text/revision，当前场次/idea实体合法。
- **具体操作**：已有5个学生点子，文字筛选2个先保存，再补3份不同图文、分类理由、审阅和正式确认。
- **判定**：两点子筛选不等于S4完成；第三份不能复印配色/同一ID；3份完整描述单与原型入选数量是两个维度；本轮覆盖单选和3选，入选均须来自已审阅完整集合，不能沿用旧1–2限制冒认新范围。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S4-10-01-before.png`；`V2N-AI-S4-10-02-result.png`；`V2N-AI-S4-10-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S4 I1–I4/O1–O4；V2:341–443；FR07/FR17；SRC29:31–153；SRC11；SRC35；SRC13:40–46；SRC14:64–79。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S4-11 · 分类由学生决定

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第3步学生选定已确认HMW有精确ID/text/revision，当前场次/idea实体合法。
- **具体操作**：一个点子同时标容易实现/有趣，突破类别可空；AI给建议但不选标签。
- **判定**：多标签不复制点子凑数；分类与投票独立保存，类别无配额；确认分类才生效。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S4-11-01-before.png`；`V2N-AI-S4-11-02-result.png`；`V2N-AI-S4-11-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S4 I1–I4/O1–O4；V2:341–443；FR07/FR17；SRC29:31–153；SRC11；SRC35；SRC13:40–46；SRC14:64–79。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。


### 范围：S5

#### AI-S5-01 · 按需入口与学生先输入

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第4步真实不同完整描述单已保存、学生入选和冻结来源可核；单选/3选用同项目独立原型实体。
- **具体操作**：首次进入/切换实体/刷新，未点整理；先手填本步要求的初稿，再主动点入口。
- **判定**：无自动模型调用/隐藏触发；手填入口始终可用；提示够具体但不代填学生首次思考。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S5-01-01-before.png`；`V2N-AI-S5-01-02-result.png`；`V2N-AI-S5-01-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S5 I1–I4/O1–O3；V2:445–535；FR18；SRC30:49–160；SRC36；SRC37；SRC14:82–99；SRC13:48。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S5-02 · 授权上下文与精确范围

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第4步真实不同完整描述单已保存、学生入选和冻结来源可核；单选/3选用同项目独立原型实体。
- **具体操作**：用本项目合成A/B实体及另一无权项目作对照，检查候选来源回执而不读取无权内容。
- **判定**：只使用本步声明范围和精确版本；同项目也不等于能读所有私聊/受访者/历史；无权材料不泄露标题或内容。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S5-02-01-before.png`；`V2N-AI-S5-02-02-result.png`；`V2N-AI-S5-02-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S5 I1–I4/O1–O3；V2:445–535；FR18；SRC30:49–160；SRC36；SRC37；SRC14:82–99；SRC13:48。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S5-03 · 缺证据/加载/生成失败

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第4步真实不同完整描述单已保存、学生入选和冻结来源可核；单选/3选用同项目独立原型实体。
- **具体操作**：缺本步必要学生初稿、空材料；再触发加载失败、权限变化、超时/工具错误。
- **判定**：明确缺项/处理中/失败可重试；保留手工草稿，不能说成功或补造；不盲目重放未知写入。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S5-03-01-before.png`；`V2N-AI-S5-03-02-result.png`；`V2N-AI-S5-03-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤15分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S5 I1–I4/O1–O3；V2:445–535；FR18；SRC30:49–160；SRC36；SRC37；SRC14:82–99；SRC13:48。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S5-04 · 单/多候选与取消

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第4步真实不同完整描述单已保存、学生入选和冻结来源可核；单选/3选用同项目独立原型实体。
- **具体操作**：分别获得证据支持的单/多候选；比较预览、切换、返回/取消。
- **判定**：候选标AI草稿/来源/未知；可正常预览/选/取消；未选者不入正式表，不固定凑数。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S5-04-01-before.png`；`V2N-AI-S5-04-02-result.png`；`V2N-AI-S5-04-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S5 I1–I4/O1–O3；V2:445–535；FR18；SRC30:49–160；SRC36；SRC37；SRC14:82–99；SRC13:48。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S5-05 · 编辑和已有稿冲突

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第4步真实不同完整描述单已保存、学生入选和冻结来源可核；单选/3选用同项目独立原型实体。
- **具体操作**：原来有学生稿，选择候选并手工修改；再取消或切实体。
- **判定**：明确替换/保留选择，不能静默覆写；编辑局部绑定当前实体，不能串到兄弟卡；刷新后符合实际保存边界。 六步均要求AI候选预览/选择/编辑不自动共享保存；要落正式产物须明确应用并按正常保存/确认协议完成。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S5-05-01-before.png`；`V2N-AI-S5-05-02-result.png`；`V2N-AI-S5-05-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S5 I1–I4/O1–O3；V2:445–535；FR18；SRC30:49–160；SRC36；SRC37；SRC14:82–99；SRC13:48。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S5-06 · 明确应用/防重复/失败重试

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第4步真实不同完整描述单已保存、学生入选和冻结来源可核；单选/3选用同项目独立原型实体。
- **具体操作**：先记录服务端revision；候选预览/选择/编辑时不点应用/保存并核无共享写入，再确认目标后点实际应用/正常保存；双击、返回重进及受控失败后重试。
- **判定**：准确显示应用到哪一产物；仅一次正式写入/实体，不因重复点击造重复；失败不假成功，未知结果先回读。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S5-06-01-before.png`；`V2N-AI-S5-06-02-result.png`；`V2N-AI-S5-06-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S5 I1–I4/O1–O3；V2:445–535；FR18；SRC30:49–160；SRC36；SRC37；SRC14:82–99；SRC13:48。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S5-07 · 保存/完成/刷新交接

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第4步真实不同完整描述单已保存、学生入选和冻结来源可核；单选/3选用同项目独立原型实体。
- **具体操作**：应用候选为草稿→回总览刷新；补齐原必需输入再从正常UI确认→刷新→下一阶段。
- **判定**：候选/保存≠阶段完成；原门槛保留；完成标记和精确revision服务端回读，下一阶段冻结同版本来源。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S5-07-01-before.png`；`V2N-AI-S5-07-02-result.png`；`V2N-AI-S5-07-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S5 I1–I4/O1–O3；V2:445–535；FR18；SRC30:49–160；SRC36；SRC37；SRC14:82–99；SRC13:48。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S5-08 · 权限/撤权/旧候选失效

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第4步真实不同完整描述单已保存、学生入选和冻结来源可核；单选/3选用同项目独立原型实体。
- **具体操作**：生成时撤回来源权限或变只读，再尝试应用；恢复合法范围后重新核对。
- **判定**：重新校验当前访问与材料授权；过期结果不落正式成果，不用缓存泄露；恢复不自动重发/确认。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S5-08-01-before.png`；`V2N-AI-S5-08-02-result.png`；`V2N-AI-S5-08-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S5 I1–I4/O1–O3；V2:445–535；FR18；SRC30:49–160；SRC36；SRC37；SRC14:82–99；SRC13:48。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S5-09 · 可用性/键盘/移动端

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第4步真实不同完整描述单已保存、学生入选和冻结来源可核；单选/3选用同项目独立原型实体。
- **具体操作**：正常键盘Tab/Enter/IME/Esc、375px及桌面浏览预览/选择/取消/保存。
- **判定**：入口可辨认、焦点可达并回到触发点，加载/错误可理解；无遮挡横溢；不force隐藏控件。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S5-09-01-before.png`；`V2N-AI-S5-09-02-result.png`；`V2N-AI-S5-09-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S5 I1–I4/O1–O3；V2:445–535；FR18；SRC30:49–160；SRC36；SRC37；SRC14:82–99；SRC13:48。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S5-10 · 先验证问题后生成

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第4步真实不同完整描述单已保存、学生入选和冻结来源可核；单选/3选用同项目独立原型实体。
- **具体操作**：仅点子名称时触发整理/生成；补主问题、预期和依据再尝试。
- **判定**：缺问题时不启动原型生成；不默认接受AI拟问题；未配参考图不阻塞；不能声称已生成文件而工具失败。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S5-10-01-before.png`；`V2N-AI-S5-10-02-result.png`；`V2N-AI-S5-10-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤15分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S5 I1–I4/O1–O3；V2:445–535；FR18；SRC30:49–160；SRC36；SRC37；SRC14:82–99；SRC13:48。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S5-11 · 图文与冻结版本

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第4步真实不同完整描述单已保存、学生入选和冻结来源可核；单选/3选用同项目独立原型实体。
- **具体操作**：选择两份不同点子的描述单和生成的两个候选；确认其中一个具体版本，随后修改源图/文本。
- **判定**：原图/核心说明真正进入授权上下文；S6和报告绑定被确认的精确版本，不只验证两个测试记录互相相等；源变化不悄悄改旧绑定。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S5-11-01-before.png`；`V2N-AI-S5-11-02-result.png`；`V2N-AI-S5-11-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S5 I1–I4/O1–O3；V2:445–535；FR18；SRC30:49–160；SRC36；SRC37；SRC14:82–99；SRC13:48。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S5-12 · 静态边界

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第4步真实不同完整描述单已保存、学生入选和冻结来源可核；单选/3选用同项目独立原型实体。
- **具体操作**：问题涉及投入时间/付费，原型仅流程图。
- **判定**：静态图只支持理解/意向，不以视觉完成认定验证成功。已批准图片/HTML/WebApp按实际表达/交互能力分别核验，生成WebApp不等于可上线或真实行为/付费已验证；视频仍不在本轮范围，不用旧静态边界免验新类型。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S5-12-01-before.png`；`V2N-AI-S5-12-02-result.png`；`V2N-AI-S5-12-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S5 I1–I4/O1–O3；V2:445–535；FR18；SRC30:49–160；SRC36；SRC37；SRC14:82–99；SRC13:48。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。


### 范围：S6

#### AI-S6-01 · 按需入口与学生先输入

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第5步正式文字/原型/验证问题已保存确认，有实际可读原型versionId；三路径用同项目独立测试实体。
- **具体操作**：首次进入/切换实体/刷新，未点整理；先手填本步要求的初稿，再主动点入口。
- **判定**：无自动模型调用/隐藏触发；手填入口始终可用；提示够具体但不代填学生首次思考。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S6-01-01-before.png`；`V2N-AI-S6-01-02-result.png`；`V2N-AI-S6-01-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S6 I1–I5/O1–O4；V2:537–651；FR19；SRC31:22–39；SRC37；SRC13:49；SRC14:102–121；SRC12:46–71。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S6-02 · 授权上下文与精确范围

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第5步正式文字/原型/验证问题已保存确认，有实际可读原型versionId；三路径用同项目独立测试实体。
- **具体操作**：用本项目合成A/B实体及另一无权项目作对照，检查候选来源回执而不读取无权内容。
- **判定**：只使用本步声明范围和精确版本；同项目也不等于能读所有私聊/受访者/历史；无权材料不泄露标题或内容。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S6-02-01-before.png`；`V2N-AI-S6-02-02-result.png`；`V2N-AI-S6-02-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S6 I1–I5/O1–O4；V2:537–651；FR19；SRC31:22–39；SRC37；SRC13:49；SRC14:102–121；SRC12:46–71。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S6-03 · 缺证据/加载/生成失败

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第5步正式文字/原型/验证问题已保存确认，有实际可读原型versionId；三路径用同项目独立测试实体。
- **具体操作**：缺本步必要学生初稿、空材料；再触发加载失败、权限变化、超时/工具错误。
- **判定**：明确缺项/处理中/失败可重试；保留手工草稿，不能说成功或补造；不盲目重放未知写入。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S6-03-01-before.png`；`V2N-AI-S6-03-02-result.png`；`V2N-AI-S6-03-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤15分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S6 I1–I5/O1–O4；V2:537–651；FR19；SRC31:22–39；SRC37；SRC13:49；SRC14:102–121；SRC12:46–71。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S6-04 · 单/多候选与取消

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第5步正式文字/原型/验证问题已保存确认，有实际可读原型versionId；三路径用同项目独立测试实体。
- **具体操作**：分别获得证据支持的单/多候选；比较预览、切换、返回/取消。
- **判定**：候选标AI草稿/来源/未知；可正常预览/选/取消；未选者不入正式表，不固定凑数。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S6-04-01-before.png`；`V2N-AI-S6-04-02-result.png`；`V2N-AI-S6-04-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S6 I1–I5/O1–O4；V2:537–651；FR19；SRC31:22–39；SRC37；SRC13:49；SRC14:102–121；SRC12:46–71。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S6-05 · 编辑和已有稿冲突

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第5步正式文字/原型/验证问题已保存确认，有实际可读原型versionId；三路径用同项目独立测试实体。
- **具体操作**：原来有学生稿，选择候选并手工修改；再取消或切实体。
- **判定**：明确替换/保留选择，不能静默覆写；编辑局部绑定当前实体，不能串到兄弟卡；刷新后符合实际保存边界。 六步均要求AI候选预览/选择/编辑不自动共享保存；要落正式产物须明确应用并按正常保存/确认协议完成。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S6-05-01-before.png`；`V2N-AI-S6-05-02-result.png`；`V2N-AI-S6-05-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S6 I1–I5/O1–O4；V2:537–651；FR19；SRC31:22–39；SRC37；SRC13:49；SRC14:102–121；SRC12:46–71。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S6-06 · 明确应用/防重复/失败重试

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第5步正式文字/原型/验证问题已保存确认，有实际可读原型versionId；三路径用同项目独立测试实体。
- **具体操作**：先记录服务端revision；候选预览/选择/编辑时不点应用/保存并核无共享写入，再确认目标后点实际应用/正常保存；双击、返回重进及受控失败后重试。
- **判定**：准确显示应用到哪一产物；仅一次正式写入/实体，不因重复点击造重复；失败不假成功，未知结果先回读。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S6-06-01-before.png`；`V2N-AI-S6-06-02-result.png`；`V2N-AI-S6-06-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S6 I1–I5/O1–O4；V2:537–651；FR19；SRC31:22–39；SRC37；SRC13:49；SRC14:102–121；SRC12:46–71。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S6-07 · 保存/完成/刷新交接

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第5步正式文字/原型/验证问题已保存确认，有实际可读原型versionId；三路径用同项目独立测试实体。
- **具体操作**：应用候选为草稿→回总览刷新；补齐原必需输入再从正常UI确认→刷新→下一阶段。
- **判定**：候选/保存≠阶段完成；原门槛保留；完成标记和精确revision服务端回读，下一阶段冻结同版本来源。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S6-07-01-before.png`；`V2N-AI-S6-07-02-result.png`；`V2N-AI-S6-07-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S6 I1–I5/O1–O4；V2:537–651；FR19；SRC31:22–39；SRC37；SRC13:49；SRC14:102–121；SRC12:46–71。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S6-08 · 权限/撤权/旧候选失效

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第5步正式文字/原型/验证问题已保存确认，有实际可读原型versionId；三路径用同项目独立测试实体。
- **具体操作**：生成时撤回来源权限或变只读，再尝试应用；恢复合法范围后重新核对。
- **判定**：重新校验当前访问与材料授权；过期结果不落正式成果，不用缓存泄露；恢复不自动重发/确认。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S6-08-01-before.png`；`V2N-AI-S6-08-02-result.png`；`V2N-AI-S6-08-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S6 I1–I5/O1–O4；V2:537–651；FR19；SRC31:22–39；SRC37；SRC13:49；SRC14:102–121；SRC12:46–71。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S6-09 · 可用性/键盘/移动端

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第5步正式文字/原型/验证问题已保存确认，有实际可读原型versionId；三路径用同项目独立测试实体。
- **具体操作**：正常键盘Tab/Enter/IME/Esc、375px及桌面浏览预览/选择/取消/保存。
- **判定**：入口可辨认、焦点可达并回到触发点，加载/错误可理解；无遮挡横溢；不force隐藏控件。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S6-09-01-before.png`；`V2N-AI-S6-09-02-result.png`；`V2N-AI-S6-09-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S6 I1–I5/O1–O4；V2:537–651；FR19；SRC31:22–39；SRC37；SRC13:49；SRC14:102–121；SRC12:46–71。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S6-10 · 真实测试与无材料分支

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第5步正式文字/原型/验证问题已保存确认，有实际可读原型versionId；三路径用同项目独立测试实体。
- **具体操作**：只有AI模拟/口头称赞/未提交Survey时请求总结；另准备真实授权记录。
- **判定**：缺真实反馈保持待测，不造测试成功；区分说法、行为、解释，Survey绑定真实答卷及版本，不把API seed算浏览器填写。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S6-10-01-before.png`；`V2N-AI-S6-10-02-result.png`；`V2N-AI-S6-10-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S6 I1–I5/O1–O4；V2:537–651；FR19；SRC31:22–39；SRC37；SRC13:49；SRC14:102–121；SRC12:46–71。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S6-11 · 原问题前后认识

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第5步正式文字/原型/验证问题已保存确认，有实际可读原型versionId；三路径用同项目独立测试实体。
- **具体操作**：测试后分别填认识改变、暂未改变、证据不足，引用真实材料。
- **判定**：三者均为有效学习分支；不事后换题冒充验证，不把意向当行为或一次结果泛化所有人。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S6-11-01-before.png`；`V2N-AI-S6-11-02-result.png`；`V2N-AI-S6-11-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S6 I1–I5/O1–O4；V2:537–651；FR19；SRC31:22–39；SRC37；SRC13:49；SRC14:102–121；SRC12:46–71。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S6-12 · 返回前四步无新版

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第5步正式文字/原型/验证问题已保存确认，有实际可读原型versionId；三路径用同项目独立测试实体。
- **具体操作**：学生选择回2补访并明确原因行动；另轮选回5修改。
- **判定**：回2保持旧原型且可结束本轮学习，不强制新版；回5新版保留前版/依据/待测标记；AI不能自动路由。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S6-12-01-before.png`；`V2N-AI-S6-12-02-result.png`；`V2N-AI-S6-12-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S6 I1–I5/O1–O4；V2:537–651；FR19；SRC31:22–39；SRC37；SRC13:49；SRC14:102–121；SRC12:46–71。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。


### 范围：按真实可建实体逐项参数化

#### CRUD-01 · 创建入口一致性

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：对每个实际支持新建的实体用普通有权成员打开创建弹窗，记录标题、字段、来源、标签和初始焦点。
- **判定**：不能把方法/标签/PDF虚构为实体；无合法上游时给出可操作缺项；名称/来源/角色状态一致。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-CRUD-01-01-before.png`；`V2N-CRUD-01-02-result.png`；`V2N-CRUD-01-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：用户最新实体新增/编辑/删除一致性；V2 FR01/02/04/11；不扩大删除权限；他lane清点S1–3/S4–6；SRC02:435–495；SRC06:151–255；SRC29；SRC30；SRC33。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### CRUD-02 · 取消创建

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：分别用取消/X/Esc/返回离开未保存表单，再刷新目录。
- **判定**：没有新增实体/标签写入/完成标记；焦点返回正常；有已创建资源的多步流程按真实契约明示后果，不假装完全原子。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-CRUD-02-01-before.png`；`V2N-CRUD-02-02-result.png`；`V2N-CRUD-02-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：用户最新实体新增/编辑/删除一致性；V2 FR01/02/04/11；不扩大删除权限；他lane清点S1–3/S4–6；SRC02:435–495；SRC06:151–255；SRC29；SRC30；SRC33。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### CRUD-03 · 创建校验和正常持久

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：测空名/空格、长度、来源、标签IME，正常创建后刷新并打开。
- **判定**：错误定位正确且保留输入；服务端保存成功后卡可见，同实体独立thread/精确来源不变。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-CRUD-03-01-before.png`；`V2N-CRUD-03-02-result.png`；`V2N-CRUD-03-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：用户最新实体新增/编辑/删除一致性；V2 FR01/02/04/11；不扩大删除权限；他lane清点S1–3/S4–6；SRC02:435–495；SRC06:151–255；SRC29；SRC30；SRC33。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### CRUD-04 · 创建失败防重复

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：各实际多步创建在已有边界模拟失败，取消/重试/双击。
- **判定**：部分成功能明确回读，不重复建原生Design或误关联；未知结果不盲重放；不扩大权限。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-CRUD-04-01-before.png`；`V2N-CRUD-04-02-result.png`；`V2N-CRUD-04-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：用户最新实体新增/编辑/删除一致性；V2 FR01/02/04/11；不扩大删除权限；他lane清点S1–3/S4–6；SRC02:435–495；SRC06:151–255；SRC29；SRC30；SRC33。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### CRUD-05 · 编辑保存与取消

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：改名/改内容/加移标签，先取消再重开，后明确保存刷新。
- **判定**：取消不改服务端；保存只改当前实体；合理失效原确认，不能保留虚假完成。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-CRUD-05-01-before.png`；`V2N-CRUD-05-02-result.png`；`V2N-CRUD-05-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：用户最新实体新增/编辑/删除一致性；V2 FR01/02/04/11；不扩大删除权限；他lane清点S1–3/S4–6；SRC02:435–495；SRC06:151–255；SRC29；SRC30；SRC33。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### CRUD-06 · 删除提示与取消

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：仅对本轮专用合成数据触发实际删除/归档入口；检查对象名/影响和取消。
- **判定**：确认提示说明真实删除或归档、关联和历史处理；取消无写入；不能无提示删错卡。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-CRUD-06-01-before.png`；`V2N-CRUD-06-02-result.png`；`V2N-CRUD-06-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：用户最新实体新增/编辑/删除一致性；V2 FR01/02/04/11；不扩大删除权限；他lane清点S1–3/S4–6；SRC02:435–495；SRC06:151–255；SRC29；SRC30；SRC33。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### CRUD-07 · 删除成功后的目录

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：正常确认删除/归档后等服务回执，刷新目录，测试标签筛选/搜索/空状态和原历史链接。
- **判定**：当前列表不再混入已归档项，有清晰空状态/清除筛选；历史按实际留存与访问契约，不能删他人或真实课程数据。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-CRUD-07-01-before.png`；`V2N-CRUD-07-02-result.png`；`V2N-CRUD-07-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：用户最新实体新增/编辑/删除一致性；V2 FR01/02/04/11；不扩大删除权限；他lane清点S1–3/S4–6；SRC02:435–495；SRC06:151–255；SRC29；SRC30；SRC33。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### CRUD-08 · 删除权限与竞态

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：只读/非成员/跨项目用既有有权QA夹具检查入口和服务拒绝；并发修改后删除。
- **判定**：UI和服务权限一致；不直接改角色/DB；409保留可恢复状态，不伪造成功。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-CRUD-08-01-before.png`；`V2N-CRUD-08-02-result.png`；`V2N-CRUD-08-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：用户最新实体新增/编辑/删除一致性；V2 FR01/02/04/11；不扩大删除权限；他lane清点S1–3/S4–6；SRC02:435–495；SRC06:151–255；SRC29；SRC30；SRC33。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### CRUD-09 · 再进与可访问性

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：操作后离开/返回/刷新，用键盘和移动端核列表/弹窗、错误和焦点。
- **判定**：列表/完成状态/来源与服务回执一致；没有遮挡或只靠颜色的状态；删除后焦点有去处。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-CRUD-09-01-before.png`；`V2N-CRUD-09-02-result.png`；`V2N-CRUD-09-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：用户最新实体新增/编辑/删除一致性；V2 FR01/02/04/11；不扩大删除权限；他lane清点S1–3/S4–6；SRC02:435–495；SRC06:151–255；SRC29；SRC30；SRC33。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。


### 范围：所有真实正式产物+系统报告

#### PRINT-01 · 所有正式产物盘点

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：对本矩阵正式产物清单逐一打开实际可见保存版本。
- **判定**：打印入口覆盖真实正式产物和报告；未实现/无入口明确记录，不能用空按钮/文本替代画布。
- **刷新核对**：打印/取消不改原内容、来源版本/阶段完成；重新打开同一产物核保存版本与预览一致，独立重新打开实际PDF核页数/纸型/中文/图像。
- **截图拟文件**：`V2N-PRINT-01-01-before.png`；`V2N-PRINT-01-02-result.png`；`V2N-PRINT-01-03-refreshed.png`；`V2N-PRINT-01-04-system-print-dialog.png`；`V2N-PRINT-01-05-pdf-render.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤10分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：#6961及用户最新A4/A3/A1/画布默认A1纠正；V2既有PDF要求；SRC05:36–42,119–130；SRC12:46–71；SRC28:107–128；SRC38:35–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### PRINT-02 · 先预览后显式打印

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：打开分页预览，尚未按打印；取消，重新打开再显式点打印。
- **判定**：打开预览不触发系统打印对话；取消无内容/阶段写入；明确点击后仅一次系统打印，完成不代表用户已另存PDF。
- **刷新核对**：打印/取消不改原内容、来源版本/阶段完成；重新打开同一产物核保存版本与预览一致，独立重新打开实际PDF核页数/纸型/中文/图像。
- **截图拟文件**：`V2N-PRINT-02-01-before.png`；`V2N-PRINT-02-02-result.png`；`V2N-PRINT-02-03-refreshed.png`；`V2N-PRINT-02-04-system-print-dialog.png`；`V2N-PRINT-02-05-pdf-render.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤10分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：#6961及用户最新A4/A3/A1/画布默认A1纠正；V2既有PDF要求；SRC05:36–42,119–130；SRC12:46–71；SRC28:107–128；SRC38:35–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### PRINT-03 · 三种纸张与默认

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：画布首次预览核默认A1，切换A4/A3/A1；每类正式产物分别保存三种真实PDF。
- **判定**：纸张选择真实生效且可回切；persona/画布默认A1且无固定张页数，其他正式产物按内容采用合理A4/A3默认并仍可选三纸型；记录最终批准设计，不用浏览器设置掩盖产品未传纸型。
- **刷新核对**：打印/取消不改原内容、来源版本/阶段完成；重新打开同一产物核保存版本与预览一致，独立重新打开实际PDF核页数/纸型/中文/图像。
- **截图拟文件**：`V2N-PRINT-03-01-before.png`；`V2N-PRINT-03-02-result.png`；`V2N-PRINT-03-03-refreshed.png`；`V2N-PRINT-03-04-system-print-dialog.png`；`V2N-PRINT-03-05-pdf-render.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤10分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：#6961及用户最新A4/A3/A1/画布默认A1纠正；V2既有PDF要求；SRC05:36–42,119–130；SRC12:46–71；SRC28:107–128；SRC38:35–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### PRINT-04 · 独立物理尺寸检查

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：用独立PDF解析器读各文件MediaBox/CropBox、旋转、页数/尺寸。
- **判定**：A4=210×297mm、A3=297×420mm、A1=594×841mm，允许横向交换；标明数值容差来源，不以文件名/截图判断尺寸。
- **刷新核对**：打印/取消不改原内容、来源版本/阶段完成；重新打开同一产物核保存版本与预览一致，独立重新打开实际PDF核页数/纸型/中文/图像。
- **截图拟文件**：`V2N-PRINT-04-01-before.png`；`V2N-PRINT-04-02-result.png`；`V2N-PRINT-04-03-refreshed.png`；`V2N-PRINT-04-04-system-print-dialog.png`；`V2N-PRINT-04-05-pdf-render.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤10分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：#6961及用户最新A4/A3/A1/画布默认A1纠正；V2既有PDF要求；SRC05:36–42,119–130；SRC12:46–71；SRC28:107–128；SRC38:35–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### PRINT-05 · 实际模板全内容

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：打印真实后台persona候选中最终正式选中模板的全部内容，核templateId/version与PDF。
- **判定**：不固定8张/8页；不把源码pdfPage=3当页数；真实模板所有表头/分区/画布及学生内容均在PDF，无删节、虚构空页。
- **刷新核对**：打印/取消不改原内容、来源版本/阶段完成；重新打开同一产物核保存版本与预览一致，独立重新打开实际PDF核页数/纸型/中文/图像。
- **截图拟文件**：`V2N-PRINT-05-01-before.png`；`V2N-PRINT-05-02-result.png`；`V2N-PRINT-05-03-refreshed.png`；`V2N-PRINT-05-04-system-print-dialog.png`；`V2N-PRINT-05-05-pdf-render.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤10分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：#6961及用户最新A4/A3/A1/画布默认A1纠正；V2既有PDF要求；SRC05:36–42,119–130；SRC12:46–71；SRC28:107–128；SRC38:35–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### PRINT-06 · 中文与图像

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：准备长中文/换行/不同长度引文和有授权照片/点子图/静态原型，独立渲染每页。
- **判定**：无方框乱码、重叠、过小字、图片丢失、裁切；图像和说明属于同一冻结版本，不能只验字节文件非空。
- **刷新核对**：打印/取消不改原内容、来源版本/阶段完成；重新打开同一产物核保存版本与预览一致，独立重新打开实际PDF核页数/纸型/中文/图像。
- **截图拟文件**：`V2N-PRINT-06-01-before.png`；`V2N-PRINT-06-02-result.png`；`V2N-PRINT-06-03-refreshed.png`；`V2N-PRINT-06-04-system-print-dialog.png`；`V2N-PRINT-06-05-pdf-render.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤10分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：#6961及用户最新A4/A3/A1/画布默认A1纠正；V2既有PDF要求；SRC05:36–42,119–130；SRC12:46–71；SRC28:107–128；SRC38:35–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### PRINT-07 · 分页不裁切

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：长报告/多卡/多描述单在三纸型逐页比较，核页首尾、标题、图注、表格及边界。
- **判定**：分页/边距合适，不裁文字/图、无重叠/漏尾/重复段；不能仅看第1页截图或文本抽取。
- **刷新核对**：打印/取消不改原内容、来源版本/阶段完成；重新打开同一产物核保存版本与预览一致，独立重新打开实际PDF核页数/纸型/中文/图像。
- **截图拟文件**：`V2N-PRINT-07-01-before.png`；`V2N-PRINT-07-02-result.png`；`V2N-PRINT-07-03-refreshed.png`；`V2N-PRINT-07-04-system-print-dialog.png`；`V2N-PRINT-07-05-pdf-render.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤10分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：#6961及用户最新A4/A3/A1/画布默认A1纠正；V2既有PDF要求；SRC05:36–42,119–130；SRC12:46–71；SRC28:107–128；SRC38:35–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### PRINT-08 · 打印授权和撤权

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：预览后来源照片撤权/项目失权/切实体，再点打印。
- **判定**：阻止过期敏感内容导出并解释；当前/历史均按授权；原文字不误删；不能用旧缓存继续打印。
- **刷新核对**：打印/取消不改原内容、来源版本/阶段完成；重新打开同一产物核保存版本与预览一致，独立重新打开实际PDF核页数/纸型/中文/图像。
- **截图拟文件**：`V2N-PRINT-08-01-before.png`；`V2N-PRINT-08-02-result.png`；`V2N-PRINT-08-03-refreshed.png`；`V2N-PRINT-08-04-system-print-dialog.png`；`V2N-PRINT-08-05-pdf-render.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤10分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：#6961及用户最新A4/A3/A1/画布默认A1纠正；V2既有PDF要求；SRC05:36–42,119–130；SRC12:46–71；SRC28:107–128；SRC38:35–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### PRINT-09 · 弹窗拦截/失败/取消

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：在正常可控浏览器里测预览资源失败、打印框取消、重复点击及关闭页面。
- **判定**：报错清楚、可安全重试、不重复正式写入/完成状态；没有已保存PDF回执就不报导出成功。
- **刷新核对**：打印/取消不改原内容、来源版本/阶段完成；重新打开同一产物核保存版本与预览一致，独立重新打开实际PDF核页数/纸型/中文/图像。
- **截图拟文件**：`V2N-PRINT-09-01-before.png`；`V2N-PRINT-09-02-result.png`；`V2N-PRINT-09-03-refreshed.png`；`V2N-PRINT-09-04-system-print-dialog.png`；`V2N-PRINT-09-05-pdf-render.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤10分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：#6961及用户最新A4/A3/A1/画布默认A1纠正；V2既有PDF要求；SRC05:36–42,119–130；SRC12:46–71；SRC28:107–128；SRC38:35–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### PRINT-10 · 精确候选和控制配对

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：记录新应用SHA、控制SHA、manifest/runtime及每次输出名、来源revision、纸型、页数、哈希。
- **判定**：新打印交互会影响旧capture流程，必须受审新控制器匹配；当前16份基线与新三纸型矩阵分开，不静默扩cap/复用旧成绩。
- **刷新核对**：打印/取消不改原内容、来源版本/阶段完成；重新打开同一产物核保存版本与预览一致，独立重新打开实际PDF核页数/纸型/中文/图像。
- **截图拟文件**：`V2N-PRINT-10-01-before.png`；`V2N-PRINT-10-02-result.png`；`V2N-PRINT-10-03-refreshed.png`；`V2N-PRINT-10-04-system-print-dialog.png`；`V2N-PRINT-10-05-pdf-render.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤10分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：#6961及用户最新A4/A3/A1/画布默认A1纠正；V2既有PDF要求；SRC05:36–42,119–130；SRC12:46–71；SRC28:107–128；SRC38:35–50。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。


### 范围：S2

#### AI-S2-14 · S2误见画像/HMW入口待复现

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第1步确认主题/反思有精确版本；当前访谈/观察来源与所需授权可核；观察是否独立实体不得假定。
- **具体操作**：按#6962用户报告，从同一普通成员专用项目第2步正常点击新建；记录实际弹窗、pathname/step/entity、显示名称和保存后的真实业务类型，再刷新回到目录。
- **判定**：先还原用户报告，不先认路由/组件/数据根因；S2应访谈/观察并保留发现卡，S3才为persona/HMW正式输出。不迁移/删除现存数据，不预写状态；未复现也保留条件/证据。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S2-14-01-before.png`；`V2N-AI-S2-14-02-result.png`；`V2N-AI-S2-14-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：用户报告#6962及最新S2/S3边界；SRC02:435–495；SRC32:创建/目录；当前已核业务类型为interview，观察独立实体待核。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S2-15 · 观察来源与独立实体边界

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第1步确认主题/反思有精确版本；当前访谈/观察来源与所需授权可核；观察是否独立实体不得假定。
- **具体操作**：清点当前第2步正常新建业务类型、访谈记录内观察文字/图片来源入口及其保存归属；用本轮授权合成观察记录验证可回溯位置。
- **判定**：如实现仅interview，应如实报告观察作为来源的支持范围；“观察是否独立可建实体”标待核/待明确实现，不能把用户目标当已实现或把观察伪装真人访谈。保留人物发现卡和原材料引用。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S2-15-01-before.png`；`V2N-AI-S2-15-02-result.png`；`V2N-AI-S2-15-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：V2 S2 I2/I3、用户最新S2访谈/观察要求；SRC32；SRC16；SRC20:94–101；观察业务实体当前待核。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。


### 范围：S3

#### AI-S3-14 · persona与HMW授权来源追溯

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第2步实际材料/发现卡保存可回读，意外发现或暂无已填写；persona/HMW入口来源精确。
- **具体操作**：分别打开persona/HMW候选的来源说明，核同项目授权访谈、观察与本组研讨的精确材料/版本；缺一类材料、引文缺定位和撤权时再检查。
- **判定**：两类都可追溯实际使用的授权来源，缺的来源如实标缺而不补造；不把AI推测写原话，不混兄弟项目/私聊。撤权后新候选/应用重新核权限，过期内容不能落正式产物。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S3-14-01-before.png`；`V2N-AI-S3-14-02-result.png`；`V2N-AI-S3-14-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S3 I1–I4/O1–O4；V2:237–339；FR16；#6959/#6960；用户最新明确persona＋HMW双正式产物范围；SRC06:313–390；SRC18；SRC20；SRC21；最新用户明确HMW范围。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S3-15 · HMW编辑确认持久与精确交接

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第2步实际材料/发现卡保存可回读，意外发现或暂无已填写；persona/HMW入口来源精确。
- **具体操作**：明确选择HMW候选，学生手工改写并从正常UI确认/保存；双击、失败回读、刷新正式列表与总览，再选为本轮HMW进入S4。
- **判定**：只有明确确认的学生版本正式入表，无重复、不覆盖已确认旧版；AI建议/保存草稿不自动完成。S4冻结同一选定HMW的ID/text/revision，保留画像/证据关联与原阶段门槛。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S3-15-01-before.png`；`V2N-AI-S3-15-02-result.png`；`V2N-AI-S3-15-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S3 I1–I4/O1–O4；V2:237–339；FR16；#6959/#6960；用户最新明确persona＋HMW双正式产物范围；SRC06:344–390；SRC02；SRC13；SRC35。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S3-16 · 两类正式产物分别预览打印

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第2步实际材料/发现卡保存可回读，意外发现或暂无已填写；persona/HMW入口来源精确。
- **具体操作**：同项目保存persona和HMW正式输出后，分别从各自正常入口打开内容/打印预览，显式打印并保存三纸型真实PDF。
- **判定**：persona使用真实后台模板全部实际内容，HMW保留最终学生问题/相关画像/证据引用；两类均独立可预览/取消/打印，A4/A3/A1真实尺寸分页可读，无替身模型或伪造PDF。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S3-16-01-before.png`；`V2N-AI-S3-16-02-result.png`；`V2N-AI-S3-16-03-refreshed.png`；`V2N-AI-S3-16-04-system-print-dialog.png`；`V2N-AI-S3-16-05-pdf-render.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤10分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S3 I1–I4/O1–O4；V2:237–339；FR16；#6959/#6960；用户最新明确persona＋HMW双正式产物范围；#6961；SRC06；SRC24/SRC27/SRC38；SRC28；新打印实现待验。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。


### 范围：所有真实正式产物+系统报告

#### PRINT-11 · 普通成员同项目正式打印E2E无替身

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：由获授权普通成员在同一个专用项目连续走真实六步；每个实际正式产出（含persona、HMW）都先预览→显式打开系统打印对话→实际保存A4/A3/A1 PDF。记录系统对话截图/取消与成功路径，并对实际PDF独立解析和逐页渲染。
- **判定**：真实应用/控制/模型范围均精确记录，不用loopback代真模型、不用API预置完成或跨项目拼证据；每正式产物有对应真实PDF/纸型/尺寸/页数/哈希/可读截图，缺项NOT_RUN/失败，不把系统对话打开当已保存。保留现有授权/门槛/控制配额，不静默扩量。
- **刷新核对**：打印/取消不改原内容、来源版本/阶段完成；重新打开同一产物核保存版本与预览一致，独立重新打开实际PDF核页数/纸型/中文/图像。
- **截图拟文件**：`V2N-PRINT-11-01-before.png`；`V2N-PRINT-11-02-result.png`；`V2N-PRINT-11-03-refreshed.png`；`V2N-PRINT-11-04-system-print-dialog.png`；`V2N-PRINT-11-05-pdf-render.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤10分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：#6961及用户最新正式E2E普通成员同项目/无替身范围；SRC01；SRC05/SRC12/SRC28；新实现/匹配控制/正式执行均待冻结。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。


### 范围：S4

#### AI-S4-14 · 明确选定已确认HMW和精确绑定

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第3步学生选定已确认HMW有精确ID/text/revision，当前场次/idea实体合法。
- **具体操作**：从S3正式已确认HMW列表选择一个进入S4；对照其文本/ID/revision；另建一条兄弟HMW，不选它，刷新本场次。
- **判定**：仅学生选择的已确认HMW进入本场次；未确认不能替代；后续Chat/Ideas列表/交接都冻结同一来源，兄弟HMW不混入。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S4-14-01-before.png`；`V2N-AI-S4-14-02-result.png`；`V2N-AI-S4-14-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S4最新确认HMW/冻结交接范围；最新已批准方案/用户语音范围；实现/控制配对待冻结，不倒认D已实现。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S4-15 · 主场次两轮真实Chat迭代

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第3步学生选定已确认HMW有精确ID/text/revision，当前场次/idea实体合法。
- **具体操作**：主场次学生先输入第一轮点子和依据，主动发送；读取实际教学反馈，学生针对它修改/拓展后再主动发送第二轮；核两个真实run和学生回应。
- **判定**：两轮均应用内真实模型/同一实体thread，第二轮回应本次真实反馈；不预制回复、不自动代选/保存/确认。六方法质量覆盖范围与实际发送次数逐项列明。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S4-15-01-before.png`；`V2N-AI-S4-15-02-result.png`；`V2N-AI-S4-15-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤15分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S4两轮Chat；不扩大旧44turn守卫；最新已批准方案/用户语音范围；实现/控制配对待冻结，不倒认D已实现。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S4-16 · 六种方法正常入口与变体

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第3步学生选定已确认HMW有精确ID/text/revision，当前场次/idea实体合法。
- **具体操作**：在同一项目创建六个独立方法实体，逐一显式选择free/reverse/scamper/analogy/role/brainwriting；查看各自提示、数量、HMW绑定并正常使用、刷新。
- **判定**：六方法均可用、解释与方法相符、独立entity/thread；不混新方法、不把回环/静态提示当真实生成质量；主场次两轮不能冒称每法各两轮，发送计划需明确闭合。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S4-16-01-before.png`；`V2N-AI-S4-16-02-result.png`；`V2N-AI-S4-16-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤15分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S4六方法；新增模型次数需匹配控制器及闭合计划；最新已批准方案/用户语音范围；实现/控制配对待冻结，不倒认D已实现。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S4-17 · Ideas列表与正式冻结交接

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第3步学生选定已确认HMW有精确ID/text/revision，当前场次/idea实体合法。
- **具体操作**：把真实Chat候选经学生审阅加入Ideas列表，编辑/分类/选取；确认3不同完整描述单，再回目录刷新并从正常入口传给S5。
- **判定**：Ideas与场次/方法/选定HMW来源准确；选择与正式完成分开，未采纳候选不入正式表；S5拿到所选idea及其确切图文版本，不被后续列表修改偷换。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S4-17-01-before.png`；`V2N-AI-S4-17-02-result.png`；`V2N-AI-S4-17-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S4 Ideas列表冻结交接；V2 ≥3不同描述单；最新已批准方案/用户语音范围；实现/控制配对待冻结，不倒认D已实现。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。


### 范围：S5

#### AI-S5-13 · 单idea与三idea选择两变体

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第4步真实不同完整描述单已保存、学生入选和冻结来源可核；单选/3选用同项目独立原型实体。
- **具体操作**：同项目建独立原型实体P-single与P-three：前者明确选一个完整idea，后者明确选三个不同完整idea；分别创建/刷新/查看绑定，取消未保存选择。
- **判定**：按最新目标支持单选和3选且不偷偷截为2个；每实体来源独立、取消不写；未实现3选如实失败，不能沿用旧1–2源码当新要求通过。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S5-13-01-before.png`；`V2N-AI-S5-13-02-result.png`；`V2N-AI-S5-13-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：用户批准S5单选+3选；与旧D 1–2源码区别待实现；最新已批准方案/用户语音范围；实现/控制配对待冻结，不倒认D已实现。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S5-14 · 逐idea逐级S1–S4来源检查

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第4步真实不同完整描述单已保存、学生入选和冻结来源可核；单选/3选用同项目独立原型实体。
- **具体操作**：在P-single/P-three逐个展开所选idea的来源，实际点击并核S4描述单→S3选定HMW/画像→S2授权访谈/观察→S1命题/反思，记录每层revision。
- **判定**：三idea各自完整来源链不只共用一个摘要；原图/核心描述真实传入，不跨项目，不漏个别idea；缺源明示，历史不被当前head替换。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S5-14-01-before.png`；`V2N-AI-S5-14-02-result.png`；`V2N-AI-S5-14-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S5逐idea S1–S4来源；V2 S5 I1；最新已批准方案/用户语音范围；实现/控制配对待冻结，不倒认D已实现。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S5-15 · 正式文字版本先保存确认再生成

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第4步真实不同完整描述单已保存、学生入选和冻结来源可核；单选/3选用同项目独立原型实体。
- **具体操作**：学生先写主验证问题、前看法/依据/边界与正式文字制作方案，至少依据实际反馈修订一次；明确保存、回读版本并确认；未确认时尝试生成，再正常选择目标类型。
- **判定**：正式文字必须服务器可回读且明确确认后才生成图片/HTML/WebApp；候选文本/聊天回复不等于已保存正式方案；修订撤销旧确认，保留版本。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S5-15-01-before.png`；`V2N-AI-S5-15-02-result.png`；`V2N-AI-S5-15-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤15分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S5正式文字保存版本确认在前；图片/HTML/WebApp在后；最新已批准方案/用户语音范围；实现/控制配对待冻结，不倒认D已实现。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S5-16 · 图片HTMLWebApp实际文件与版本

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第4步真实不同完整描述单已保存、学生入选和冻结来源可核；单选/3选用同项目独立原型实体。
- **具体操作**：同项目独立原型变体依次选择图片、HTML、WebApp实际支持的生成入口，生成并预览/打开保存产物；修改后再存新版本，对照notes与实际内容。
- **判定**：每类型有真实可读产物/精确版本；HTML内容真可渲染，WebApp所声称交互实际可操作；静态图不冒充交互、失败不报成功。未实现类型记失败/阻塞，不将新增WebApp要求倒写进V2旧静态边界。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S5-16-01-before.png`；`V2N-AI-S5-16-02-result.png`；`V2N-AI-S5-16-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤15分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：用户批准S5新增图片/HTML/WebApp，旧V2静态优先为历史边界；最新已批准方案/用户语音范围；实现/控制配对待冻结，不倒认D已实现。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。


### 范围：S6

#### AI-S6-13 · 三路径均绑定正式原型版本

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第5步正式文字/原型/验证问题已保存确认，有实际可读原型versionId；三路径用同项目独立测试实体。
- **具体操作**：从已确认正式原型创建三张独立测试实体（线下/Survey/User Research）；逐张核原型实体/真实versionId/S5保存revision/原验证问题；改变S5当前选择后刷新三卡。
- **判定**：每路径都绑定原先正式版本，不仅比较测试卡彼此一致；后改head不偷换；缺正式原型/问题时不提前创建假完成，三路径独立thread和材料不串。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S6-13-01-before.png`；`V2N-AI-S6-13-02-result.png`；`V2N-AI-S6-13-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S6正式原型version+三路径；最新已批准方案/用户语音范围；实现/控制配对待冻结，不倒认D已实现。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S6-14 · 线下同意测试音频ASR报告

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第5步正式文字/原型/验证问题已保存确认，有实际可读原型versionId；三路径用同项目独立测试实体。
- **具体操作**：在本轮合成测试材料和允许范围内走正常线下测试入口，明确告知/同意；主动开始/停止音频，检查真实录音原件→ASR转写→学生校对→测试报告，核授权撤回/失败重试。
- **判定**：无同意不开录、不默认持续；ASR实际处理和转写出处可核，不能贴预制转写冒充；报告区分真实测试与合成角色/材料，不称真人课堂已验；无设备/服务记阻塞。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S6-14-01-before.png`；`V2N-AI-S6-14-02-result.png`；`V2N-AI-S6-14-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤15分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S6线下知情同意/音频/ASR/报告；新增capture/ASR控制需闭合；最新已批准方案/用户语音范围；实现/控制配对待冻结，不倒认D已实现。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S6-15 · Survey明确用于测试发布和真实答卷

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第5步正式文字/原型/验证问题已保存确认，有实际可读原型versionId；三路径用同项目独立测试实体。
- **具体操作**：从绑定正式原型的测试卡进入既有Survey，明确测试目的/问题，正常UI编辑、发布、访问填写并提交；回测试卡选取该实际答卷和版本，检查兄弟Survey隔离。
- **判定**：真实UI发布/填写/提交均有回执；不能只用API seed/create/publish/submit充浏览器通过，草稿/未提交不算答卷；问题和答卷关联实际被测原型，撤销/权限错误不套另一份。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S6-15-01-before.png`；`V2N-AI-S6-15-02-result.png`；`V2N-AI-S6-15-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤15分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S6 Survey测试明确发布/填写/实际答卷；最新已批准方案/用户语音范围；实现/控制配对待冻结，不倒认D已实现。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S6-16 · 既有User Research完整链及原段回链

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第5步正式文字/原型/验证问题已保存确认，有实际可读原型versionId；三路径用同项目独立测试实体。
- **具体操作**：从同一项目测试实体正常进入既有User Research，确认原型/研究目标，生成并编辑大纲，主动开始标模拟的对话；形成具体功能反馈和需求，再逐条点击来源原段。
- **判定**：复用既有User Research，不另造简化替代流程；大纲→模拟对话→功能反馈/需求→原始段落与版本实际可点击定位；模拟始终标模拟，不冒充真人验证/真实课堂。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S6-16-01-before.png`；`V2N-AI-S6-16-02-result.png`；`V2N-AI-S6-16-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤15分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S6既有User Research大纲→模拟对话→功能反馈/需求原段回链；最新已批准方案/用户语音范围；实现/控制配对待冻结，不倒认D已实现。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

#### AI-S6-17 · 三路径认识变化与报告不混淆

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 第5步正式文字/原型/验证问题已保存确认，有实际可读原型versionId；三路径用同项目独立测试实体。
- **具体操作**：分别从三路径真实产物整理学生认识变化/返回行动，保留路径类型与证据属性；总报告中逐条点击证据，查看授权和原型版本。
- **判定**：线下真实/合成与Research模拟清楚分层；没有真实用户反馈不称验证成功；Survey/音频/Research来源不串，报告保留未测/缺口，回前四步不强制新原型。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-AI-S6-17-01-before.png`；`V2N-AI-S6-17-02-result.png`；`V2N-AI-S6-17-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：S6三路径独立来源、反思及最终报告；最新已批准方案/用户语音范围；实现/控制配对待冻结，不倒认D已实现。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。


### 范围：按真实可建实体逐项参数化

#### CRUD-10 · 全实体弹窗标签完整生命周期

- **前置**：已通过review与受保护CI的同一整合候选已一次安装Dev，源码/manifest/runtime与控制配对可核；root独立QA的获授权普通成员及同一专用主项目；此案尚未执行。 按本案真实正式产物或可建实体盘点，来源/写权限明确；删除仅本轮专用合成数据。
- **具体操作**：按实际可建实体清单逐项执行新建/编辑/删除弹窗、取消/X/Esc、名称/来源校验、标签新增/已有选择/移除/IME/上限、保存/删除确认与刷新目录；只本轮专用测试数据。
- **判定**：不能抽一张卡代全实体通过；标签不被拼进名称、取消不写、保存仅当前实体、失败不丢稿；归档标签不导致无可恢复空列表；普通权限和历史留存不放宽。
- **刷新核对**：正常操作成功/取消/失败后离开再进入并刷新，比较当前实体、服务端revision、正式列表、完成状态和冻结来源；不得以本地状态替代回读。
- **截图拟文件**：`V2N-CRUD-10-01-before.png`；`V2N-CRUD-10-02-result.png`；`V2N-CRUD-10-03-refreshed.png`。
- **版本记录**：待填写：applicationSHA/imageTag/manifest/runtime、controllerSHA、org普通角色/projectId、stage/entity/thread/run、source revisions/material/templateId+version/designVersion/surveyResponse或Research原段ID（按本案适用）；不记录凭据。
- **时限**：每实例≤8分钟；单次本案交互；参数化方法/实体/纸型逐个实例计时且在事先冻结总执行计划内，不自动重跑或无限追加实例。 到时记录checkpoint、具体请求/日志和未知写结果；只读回查，交原修复lane；未做项NOT_RUN，不能放宽断言/守卫/超时或换项目拼证据。
- **依据**：用户最新全实体CRUD弹窗/标签；复用原CRUD-01–09逐实体参数化；最新已批准方案/用户语音范围；实现/控制配对待冻结，不倒认D已实现。
- **执行状态**：**NOT_RUN**；实际结果：________；开始/截止/实际结束：________；实际截图/PDF/服务回读：________；缺陷/阻塞/owner：________。

## N5. 本轮结论（空白，不代验收）

| 项 | 操作者填写 |
|---|---|
| 同一精确Dev、普通成员、主项目完整新E2E | NOT_RUN：________ |
| 六步正式输入/真实迭代/选择/保存/完成勾与精确交接 | NOT_RUN：________ |
| 全实体CRUD/标签、按需AI不自动save/越权 | NOT_RUN：________ |
| S5单选/3选/逐idea来源/文字版本/三类型真实产物 | NOT_RUN：________ |
| S6三路径/原型版本/实际答卷/音频ASR/Research原段回链 | NOT_RUN：________ |
| 全正式产出与报告实际三纸型PDF/系统对话/逐页检查 | NOT_RUN：________ |
| 未测、失败和下一步修复/独立复验精确版本 | ________ |
| 本轮结论/签名/时间（不等于CN授权） | ________ |

---

# 历史原文边界开始：以下为34c76bce8原件逐字存档

**以下H01–H15、M记录和旧“本轮”语句只对应历史时点，不是本次112案的执行或通过回执；旧授权/额度/后置项不覆盖上面的最新批准范围。历史原件正文从下一行开始，全文432行按原bytes保留。**

# AIDT V2 人工端到端测试与验收手册

版本：2026-11-17（北京时间） · 用途：课程负责人、学生试用者与测试人员共同验收。需求依据：[用户 V2 原文](../../../../requirements/aidt-v2-full.md)、[新增条款摘录](../../../../requirements/aidt-v2-delta.md)。

**本手册不是通过证明。** 下表的人工实际结果、证据、签字均留空，须由实际操作者填写。自动化结果单列于文末，不代替课堂教学判断、人类设计签核或人工验收。未实现、待签核、运行失败、缺少真实依赖的项目均不能勾选“通过”。

本轮更新：用户已重新授权真实模型与浏览器测试，不再因旧 QA 额度暂停。本次使用独立新小组与账本，旧失败、未知用量及 pending 保留。M01–M25 是各自当时版本的历史记录，不能当作本轮最终状态；新一轮实际结果及未解决问题见[本轮修复测试报告](../../remediation-20261117/test-report.md)。本手册仍保留 H01–H15 人工操作、结果栏和签字空白，不代填通过。

## 1. 验收登记

| 项目 | 填写 |
| --- | --- |
| 验收日期、时区 | ______________________________ |
| 候选版本 / 源码版本 | ______________________________ |
| 应用入口（由测试负责人提供，不写私密管理地址） | ______________________________ |
| 浏览器、系统、屏幕尺寸 | ______________________________ |
| 测试负责人 / 课程负责人 | ______________________________ |
| 小组甲 / 小组乙 / 课程标识 | ______________________________ |
| 实际模型与 Agent 服务是否可用 | □ 可用　□ 不可用；证据：________________ |
| 本轮约定的测试范围与后置事项 | ______________________________ |

状态规则：□ 通过　□ 失败　□ 待测　□ 阻塞/未实现　□ 经负责人明确排除。每项必须记录实际结果与证据编号；“页面上有提示”“接口名存在”“AI说完成了”“自动化通过”均不能单独作为人工通过理由。后置事项须有负责人记录，不能以“通过”替代。

## 2. 环境、账号与准备数据

请测试负责人在隔离测试环境提供账号，不在本手册、截图、录屏或缺陷中填写密码、会话令牌、模型密钥。不要在生产组织邀请真人、归档真实项目或更改权限。

| 角色 | 准备与边界 | 实际账号代号 |
| --- | --- | --- |
| 配置者 M | 已授权的课程/组织管理者，只在隔离课程创建练习组、分配测试成员；不代学生确认结论 | __________ |
| 学生 A | 小组甲成员，负责主要输入和保存 | __________ |
| 学生 B | 小组甲另一真实账号，在独立浏览器/无痕窗口操作，不复制A的会话 | __________ |
| 学生 C | 小组乙成员，不属于甲，用于非组员隔离检查 | __________ |
| 教师 T | 只访问被授权课程；若该功能未交付则记录未实现，不能用M代替 | __________ |
| 匿名 U | 全新无痕窗口，未登录 | __________ |

准备两组独立数据：甲研究“新同学理解取餐指示”，乙研究“图书馆空位提示”。所有自动化或人工编写的访谈、照片、用户和反馈均须以“合成课堂材料/模拟”标注；真实访谈必须获得许可并具有可定位的材料，不能把本手册示例改标成真实研究。

准备材料：`SYN-A.txt`（两段模拟原文，有行号或段落定位）、`SYN-A.png`（无真人/无个人信息的合成场景图）、`SYN-B.txt`（与A判断矛盾的模拟材料）、三张不同点子的示意图、两条模拟测试反馈（含一条反例）。保留文件原件及文件大小，供下载核对。录音/语音和转写按用户此前决定另排；本轮不能用个人录音或绕过知情同意的方法补齐。

可选下载：[人工验收合成材料包（11个文件）](https://chatgpt.com/api/library/files/libfile_fde3_f-ba894b7459748191907ad280b433133b_f2550309ede48191b6efb8c3155855a5/download)。含模拟文字、模拟反馈、三点子与合成PNG，以及README/SHA256核对清单；**全部是合成教学夹具，没有真人访谈、个人信息或私密配置**。上传后仍须保留“模拟”标记，不可把文件可读或校验一致写成研究已验证。

源码也随附同套合成材料，位置为`apps/web/e2e/fixtures/aidt-v2/`，使用`SHA256.json`核对。自动化从`apps/web`运行时默认读取`e2e/fixtures/aidt-v2`，可用`AIDT_V2_FIXTURE_DIR`指定自己的材料目录；不依赖云环境的绝对路径。

历史七场收费 lane 的复现规则（不代表用户本次新增授权的次数上限）：收费自动化另需显式设置`AIDT_V2_RUN_LEDGER`为自己私密工作目录中的绝对`.json`文件路径；同一轮所有进程共用同一文件，不删除或新建另一文件来重置预算。测试保留七次上限、未知失败占用、同Skill重发拦截和原子锁；这份总账不是模型密钥配置。

证据命名：`H01-…`表示人工截图/导出/操作记录；`M01-…`表示独立机器证据；`D01-…`表示缺陷。截图避开账号密码页与私密配置，只保留小组代号、版本、可见结果及必要来源。

## 3. 逐项人工验收

### H01 · FR01 课程、小组、成员与所属组入口

前提：M已获测试课程管理授权，A/B属甲、C属乙；课程关系入口已交付。若只存在独立项目或自由文本课程标签，记录实际边界，不把它当正式课程关系。

1. M从产品入口建立/选择测试课程、小组与成员；记录甲/乙和成员关系。
2. A从已有导航进入所属小组甲，不仅粘贴直达地址；退出后重新登录，从列表再次进入。
3. B独立登录并打开甲；C在乙中操作，再尝试打开甲的页面与已知材料链接。
4. 比较甲乙的六步稿、Chat、报告和材料；不得因同名标题或切组显示另一组数据。

预期：课程/组/成员关系与实际权限一致，成员可重入；非成员看不到甲的内容与文件，不泄露正文或存在性细节。未签核的课程关系明确记录，不由标签暗示后台已建立。

| 状态 | 实际结果 | 证据 | 缺陷/阻塞 |
| --- | --- | --- | --- |
| □通过 □失败 □待测 □阻塞 | __________________ | __________________ | __________________ |

### H02 · FR02 / FR04 六步导航、输入、迭代成果与共享保存

前提：A进入甲，B已在独立窗口打开同组。

1. 逐步打开六步，记录实际阶段名、学生输入区、Agent入口、当前成果和保存状态。
2. A填写一项带唯一标识的草稿，切步再返回，区分本页未保存、共享已保存及个人检查点。
3. A显式保存到小组，记录服务回执版本、时间与编辑者；B刷新后核对同一内容。
4. A修改并再保存，重新登录再进入；核对新版和旧版是否可区分、选择理由是否保留。

预期：六步与最终报告连续可导航；未保存稿不能被标成共享保存或阶段完成。每步能看清“学生输入→学生审阅/选择→迭代成果→下一步继承”；保存不等于全员同意或研究已验证。返工不清空已保存历史。

| 状态 | 实际结果 | 证据 | 缺陷/阻塞 |
| --- | --- | --- | --- |
| □通过 □失败 □待测 □阻塞 | __________________ | __________________ | __________________ |

### H03 · FR03 / FR15 第一步先输入，再由真实引导师追问

前提：真实Agent与模型服务就绪；学生尚未确认第一步理由。不能使用回环、预置回复或模型直连来替代应用内Agent。

1. A先写原始命题、暂定用户/场景/活动；“为什么值得研究”先写自己的理由。
2. 来源先只选“猜测”，写清模拟材料/尚无观察或访谈；再试多选观察/抱怨，核对原说明不丢失。
3. 保存未确认草稿。打开现有原生Chat，阅读将带入的已保存版本与范围；发送一次请求，请引导师帮助澄清来源或模糊处。
4. 等待真实运行和回复，记录线程、运行/消息标识或可审阅的运行证据。检查是否提出适当追问、保留不同意见、等待学生回答。
5. A回答追问，修改理由/来源与最终研究方向，再自行确认并保存；B读取相同成果。改变来源说明后，检查原确认是否失效。

可选原生任务确认分支：若出现`confirm_task_intent`理解/假设卡，先核对卡只针对当前自有小组、本阶段学生已输入任务，猜测/未验证状态仍保留，且没有外发、新资源权限或高影响操作。学生可以修改或拒绝；确认时通过现有UI明确选择一次，继续**同一线程/同一运行**，不重新发送一条S1请求。记录实际卡内容与选择。该操作不是全局工具授权，不自动确认阶段成果、全员共识或共享保存。

服务端来源链须分层核对，不能只看前端：

| 层级 | 人工核对对象 | 当前状态 / 实际结果 |
| --- | --- | --- |
| 准备 | 自有小组、阶段、明确保存版本、对应Skill pin与有效权限 | __________________ |
| 组装 | 服务端实际模型入参所使用的来源快照/只读哈希回执；伪造客户端正文不能成为可信材料 | 历史M17–M20检查点（当前修复见M26）：真实PG/实际适配器本机HTTP集成22项通过（M17）；浏览器prepared读取已过（M18）；本次S1/S2来源组装与实际派发已实测（M19/M20），但基础echo夹具冲突与教学缺陷另列，不能计教学通过；人工结果：__________________ |
| 派发 | 同一真实run的派发/用量/结算与来源快照对应，恢复时不偷换新head | __________________ |

当前来源机制与历史实证分开核对：现行请求的`forwardedProps.aidtContext`仅含strict selector的项目、阶段和明确版本坐标；应用不自动夹带已保存材料正文，正文由服务端读取并冻结。原生messages逐字保留学生输入，允许学生主动引用材料原话，不能为了“无自动夹带”而删改人话。独立读取真实来源回执，区分prepared、assembled、message-dispatch-observed与合法同run恢复，不能把准备或组装当作已派发。旧机制曾在wire发送marker但后端丢弃TeachingContext，该失败记录保留。以下为 M17–M20 原记录时点的状态，后续修复与实际复验见 M26：新桥接22项无供应商费用集成及浏览器仅受理/prepared回执检查已通过；本次M19/M20另有真实供应商来源派发实证。M19的S1机械流程通过但实际追问含多个子问题，且所用基础Agent为echo测试夹具；M20的S2因此误认任务而被取消，不计教学成功。S3–S6及SUM新收费场景仍未运行。后续收费须由协调者明确总次数，不能靠反复发送试错。

预期：沿用WorkspaceX原生Chat界面与交互；同一引导师按本步Skill工作。AI不替学生完成访谈、不自动保存/确认、不默认选择其推荐方向。猜测仍明确待研究，观察也不等于原因已证实。原始命题、学生重写命题、理由/来源与追问回应可对应。

| 状态 | 学生判断/实际追问与回应 | 证据 | 缺陷/阻塞 |
| --- | --- | --- | --- |
| □通过 □失败 □待测 □阻塞 | __________________ | __________________ | __________________ |

### H04 · FR05 / FR06 第二步材料上传、原文与解释分离

前提：A准备合成文字/图片，明确上传文件不等于已向AI发送。若独立上传接口或可下载来源尚未实现，记录阻塞。

1. 通过产品真实上传入口上传`SYN-A.txt`与`SYN-A.png`，观察处理中、成功或失败状态。
2. 核对材料归属甲/当前阶段、提交者、时间及来源。原件回读后仅加入草稿；主动保存本步成果并核对共享版本回执，再重新进入打开/下载，与原件的文字、图像和大小核对。
3. 新建人物发现卡：受访者代号写“合成角色A”，原话写“[模拟原话]我先找牌子”，原文定位写文件名/第几段；学生自己的发现标题和解释分开填写。
4. 如使用AI辅助整理，把AI推测放到独立标记字段，核对不覆盖原话；未有支持材料的洞察标待验证。
5. C/匿名尝试材料链接；检查无法读取原文件。使用错误格式、失败上传或断网后重试一次，核对不把失败当成功、不重复生成来源。
6. 学生填写“采纳建议后的问题清单”，打开“预览采纳清单”和“PDF 打印预览”，在浏览器另存实际PDF并重新打开。核对只含采纳稿、原提纲没有混入；原稿折叠对照仍在。AI不可用时，可自行修订并明确记录人工完成，不能称AI采纳成功。打印或保存失败时，确认文字保留后重试。

预期：上传回执、文件可读性和来源关联均真实；照片引用不是只保存本地文件名/临时blob。模拟与AI推测不能进入“真实访谈”分类；原始证据、学生解释、AI推测清楚分开。录音/语音另排并记录，不能自行勾通过。

| 状态 | 实际上传/下载与来源 | 证据 | 缺陷/阻塞 |
| --- | --- | --- | --- |
| □通过 □失败 □待测 □阻塞 | __________________ | __________________ | __________________ |

### H05 · FR16 第三步意外发现、例外与“暂无”

前提：第二步至少一份已保存的合成发现卡，记下S2版本。

1. 在画像之前选择“有意外发现”，填原先判断、实际看到/听到的反例与学生解释；不关联任何材料时先存草稿，检查仍待补充。
2. 主动关联发现卡或可定位原始材料，确认并保存。核对关联的是实际S2保存版本，非悄悄采用最新内容。
3. 修改第二步材料后再回第三步，检查旧引用保留及需重新核对的提示；由学生重新确认才更新引用。
4. 另存一轮或另一练习组，显式选择“暂无意外发现”，确认保存并继续画像/HMW。

预期：“暂无”可正常继续、不扣分、不自动要求补访，AI不编造惊喜。发现/矛盾/少数例外保留，单个角色不被推广成全体洞察。非空发现缺来源时不能假称已关联。旧版可回读。

| 状态 | found/none及S2来源版本 | 证据 | 缺陷/阻塞 |
| --- | --- | --- | --- |
| □通过 □失败 □待测 □阻塞 | __________________ | __________________ | __________________ |

### H06 · FR07 / FR17 第四步分类、选择与三份不同描述单

前提：学生已明确问题/HMW；三点子分别为纸面分区牌、同伴口头指路、号码牌分区，不通过复制同一点子凑数。

1. 输入三个不同点子的名称、真实可打开的示意图及两三句核心说明；分别写清给谁、如何使用、想了解什么。输入不足两句时观察提示，不把空壳当完整描述单。
2. 将点子一同时标为“最容易实现”“最有趣”，点子二可暂不分类，某类可为空；填写分类理由并学生确认。
3. 修改一项分类理由，检查确认取消、已有选择不丢失；重新确认。进行现有选择或投票，明确两者区别，不自造票额/平票规则。
4. 打开描述单预览：应有三个不同点子，名称、图片、两三句说明、已确认标签/理由对应原点子。
5. 分别请求打印/另存三份PDF，再打开实际保存文件检查中文、图片、分页、可读性及每份只含对应点子；若合并导出，再核对三份均存在且不重复。

预期：分类与选择/投票分别保存，多标签不复制点子，不要求三类各一份配额。原生打印按钮只表示请求打印；**必须实际另存并打开PDF，不能把预览或打印提示当成已有PDF文件**。记录本轮实际使用的导出方式。

| 状态 | 三点子ID/选择/实际PDF文件名 | 证据 | 缺陷/阻塞 |
| --- | --- | --- | --- |
| □通过 □失败 □待测 □阻塞 | __________________ | __________________ | __________________ |

### H07 · FR08 / FR18 第五步先确认问题，再生成真实静态原型版本

前提：已有学生选择的点子与描述单，真实Design服务可用。

1. 主问题为空时保存草稿，尝试生成：不能自动生成，也不能由AI给问题后默认已接受。
2. 学生填写“这次最想知道什么”、测试前看法及依据、原型类型/用户界面/文字、可选参考图、可了解与不能验证范围；说明如何观察，显式确认问题后保存。
3. 打开现有原生Design Workbench，核对它显示的已保存问题/HMW/选择描述单及版本。主动带入制作说明，审阅原生输入框后显式发送。
4. 等待真实静态方案，查看页面/图片与版本记录。选择一个真实服务器版本，并尝试修改后另存；再次进入，核对指定版本内容而非只看名称。
5. 修改验证问题/依据，检查确认取消；重新确认后保留原先问题修订。记录真实designId/versionId或相应可核对版本标识。
6. 对照实际保存版本的页面、图片或下载文件，分别记录“notes／制作说明声称什么”和“文件实际呈现什么”。声称有跳转时检查该版本是否真有交互；静态按钮、控件名称或notes中的属性描述都不能单独证明可点击。原题要判断号码去哪个区时，画面若无具体映射，记录原型适用性不足，不能只凭生成成功过关。
7. 核对原型与本轮问题是否相容：静态图可用于理解检查或意向反馈；若要判断实际等待、时间投入或付费，另记所需真实体验安排。把截图、实际文件及精确版本作为证据；notes保留为声明，不代替文件检查，也不因说明中写“可验证”就标记问题已被验证。

预期：未确认不启动生成；生成成功有实际可读的静态内容与版本，按钮/文字引用不算成功文件。每个候选回应同一验证问题，学生保有选择。静态理解/意向不能证明真实时间投入或付费。生成质量另由人类审阅。

| 状态 | 主问题/原型真实版本/范围 | 证据 | 缺陷/阻塞 |
| --- | --- | --- | --- |
| □通过 □失败 □待测 □阻塞 | __________________ | __________________ | __________________ |

### H08 · FR09 / FR19 第六步测试材料、前后认识与旧版绑定

前提：S5已有确认问题、先前看法与真实静态原型版本P1；测试材料使用合成标记或经许可的真实材料。

1. 明确带入S5到S6，核对原问题、先前认识和P1版本快照。修改S5问题/改选P2，回S6检查已带入的P1与原题未被静默覆盖。
2. 在“测试原始材料”上传反馈文字与图片，核对上传回执、原件预览和来源，主动保存到小组；重新登录后打开/下载原件。录入测试问题、两条不同反馈及材料定位，反例、未解问题与学生解释分开；无真实测试时保留“合成/待测试”标记。
3. 分别保存三种学习决定：认识变化、暂未改变、证据不足；每种都写依据和仍不确定处。不要因模拟用户说“不错”就标解决成功。 新增或移除测试材料会撤销本轮学习确认，重新核对后再确认、保存。
4. 回看历史版本，对照变化前后问题、依据、反馈和被测试原型；若改写问题，保留原文及原因。
5. 使用SYN-TEST-FEEDBACK.txt之前，打开实际被测试的P1文件，检查示例所说的编号、分区和控件是否真实存在；不要仅核对notes。模板只是通用合成练习；例如P1没有“2→B”映射时，不能把模板F1/F2当本版本实测，须另写实际静态检查并保持未真人测试。发现notes与文件矛盾时保留两者和版本，记录缺陷，不用较新的P2画面替P1补证据。
6. 将“实际用户行为”“用户口述”“学生静态文件检查”“合成练习反馈”分开记录，并注明各自能支持什么。静态文件中的按钮或流程图不证明点击功能、真实参与意愿或真实使用行为；新版文件／notes已生成也不表示新一轮测试已通过。认识变化应引用本轮实际材料，并保留无法判断的部分。

预期：原问题及P1不可被事后换题/换版本；“未改变”“证据不足”均可保存。真实材料不足明确缺口，AI生成内容不变成访谈。保存学习不等于验证成功或完成课程。

| 状态 | 原题/前后认识/材料/P1版本 | 证据 | 缺陷/阻塞 |
| --- | --- | --- | --- |
| □通过 □失败 □待测 □阻塞 | __________________ | __________________ | __________________ |

### H09 · FR19 返回1–5、未决定与按需新版本

前提：S6已保存一轮反思，记下V1及其独特返回理由；稍后再保存不同理由的V2/V3。

1. 分别选择优先回第1、2、3、4、5步，填写每轮理由、材料或未解问题、下一步行动和想了解什么；逐轮保存，不把一次保存当新完成学习轮次。
2. 也保存“未决定/需要支持”，不让AI代选或强制导航；检查当前稿可继续讨论。
3. 用旧轮次V1返回对应步骤，在成果页和原生Chat展开返工上下文，核对显示旧理由与行动而非最新V3；当前最新S6不自动改写。
4. 用错误目标步骤或缺失历史轮次进入，检查无错误理由混入AI、旧内容不泄漏、可以重读且Chat仍能输入。
5. 返回第1–4步时不生成原型也能继续修订；旧P1保留。只有学生选择继续原型、确认新问题并主动生成/编辑时，才建立P2并标待测试。
6. 核对P2可追溯到本轮反思/反馈及旧P1；旧S6快照仍是P1，不被新的选择覆盖。
7. 选择版本后等“已记录”的完整版本ID出现再编辑关联字段；若加载中修改选择条件，旧挂起选择应被取消，不能迟到后关联错误版本。

| 子项 | 预期 | 状态 | 实际结果 / 证据 |
| --- | --- | --- | --- |
| 回1 | 重审问题与理由；旧轮次原文保留 | □通过 □失败 □待测 | __________________ |
| 回2 | 补研究；旧证据与未解不清空 | □通过 □失败 □待测 | __________________ |
| 回3 | 重综合定义；旧画像/HMW可追溯 | □通过 □失败 □待测 | __________________ |
| 回4 | 重构思；旧点子与选择保留 | □通过 □失败 □待测 | __________________ |
| 回5 | 学生主动继续原型时另存新版 | □通过 □失败 □待测 | __________________ |
| 未决定 | 可保存并请求教师支持，不自动代选 | □通过 □失败 □待测 | __________________ |
| 错误/缺失 | 不带入错误历史，Chat可用，可重试 | □通过 □失败 □待测 | __________________ |
| 不强制新版 | 回1–4不先生成P2也可继续 | □通过 □失败 □待测 | __________________ |

缺陷/阻塞：________________________________________________________________

### H10 · FR10 真实报告引导师、学生审阅、缺口与导出

前提：甲六步至少部分已保存，特意留一个来源缺口；若无真实教师点评，应保持缺失。

1. 从第六步“小组报告”进入报告引导师；检查仍是同一原生Chat体验，汇总任务有独立线程/总结Skill，普通S6对话不被替换。
2. 主动读取报告材料。先核对常显的“本次选择”、缺失步骤、读取失败和教师点评来源；存在预览截断时，不展开详细JSON也应能看到提示。再展开历史版本与正文，核对六步精确保存版本、旧轮次反思及缺口。记录“选择了哪些版本”和“预览展示多少”两个事实，不能把它们当作模型已读全文。
3. 主动带入请求，审阅原生输入框后再发送；等待真实运行与持久结果。记录对应线程/消息/运行来源。
4. 回报告页主动读取真实AI结果，选择具体消息或产物。在AI正文之前核对常显的“先核对来源，再审阅报告”：本轮固定current版本、history版本及是否truncated；展开“未读材料与应用状态”核对omissions、未读取原始文件／无来源点评和运行状态。消息、run、产物不可变修订须与所选结果对应；固定回执不因当前head变新而被替换。prepared／assembled不等于实际派发，派发也不证明模型正确覆盖全部材料。
5. 对照所选原生Chat消息／产物与预览逐字核对AI正文。追加后的“软件记录的来源范围（不是AI报告正文）”应与“所选AI原文（未经软件改写）”分开；软件元数据不能冒充AI主动披露了缺口，也不能自动补写V2已生成、研究成功或教师点评。未勾“我已核对AI草稿、材料缺口与点评来源”时，追加按钮应禁用，不自动采用。
6. 先在现有人工报告末尾加入一个唯一标记，再审阅勾选并主动追加AI稿。核对标记和旧正文逐字保留，所选AI原文仅追加一次；此时共享保存版本不应自动增加。只有学生显式保存才产生新回执。保存前后分别核对旧reportRefs／来源版本与S6阶段稿：追加新run来源元数据不应自动把旧正文重标为最新阶段版本，也不应覆盖阶段反馈或原型快照。
7. 新登录重新打开报告，核对人工修改、旧轮次理由、AI来源范围、原来源版本和缺口均保留。读取或选择AI结果本身不得改写原报告；重复选择须重新审阅，不能沿用上一次勾选自动采用。
8. 导出并打开实际文件；核对问题演变、证据与例外、三点子/选择、原型版本、测试/认识变化、返回决定、已有点评或缺口、后续建议。实际另存PDF须打开验证，并区分学生已保存版本与尚未保存的导出草稿。
9. 若来源回执标记truncated，定位被截断的阶段／历史版本和未读范围，检查AI原稿是否也如实披露；软件警告不能代替模型内容检查。有实际V2及旧return2→新return5时，核对AI稿、真实文件和精确保存版本，不可只写V1或把V2当未来构想。缺项由学生另存纠正修订并重导出；保留旧AI稿／旧导出，不能用人工纠正追认模型已读全。
10. 使用测试负责人提供的隔离反例检查失败处理，并注明是真实权限检查还是受控故障注入：会话失效／401／403、project或run回执错配、summary任务不匹配时，旧候选／预览不得继续用于追加，报告人工编辑保留，可重新授权后重读。无法安全复现的分支记待测，不修改生产权限或冒称已验证。
11. 单独检查missing receipt或回执服务读取失败分支：应明确显示“运行材料回执未能读取，无法核对本轮版本与截断范围”，不能显示已完整读取或沿用另一run回执。所选AI原文和当前人工稿保留；若学生自行核对后仍决定追加，必须再次显式审阅，来源未知提示应随软件来源记录保留，仍不自动保存。取消读取或切换账号／小组后，迟到结果不能重新出现并覆盖当前稿。

若总结任务出现原生理解/假设确认卡，同H03检查当前组、报告任务和材料缺口，允许学生修改或拒绝后再明确确认；继续原运行，不能重新生成以绕过确认，也不把任务确认等同报告导入/共享保存。

总结也须按H03逐层核对准备、服务端组装和实际派发的来源回执。`forwardedProps.aidtContext`选择明确当前/历史版本坐标，学生原话不改，服务端冻结材料范围。此前旧版真实SUM曾成功运行和导入导出，但实际回执为truncated，不能用选中全部坐标或派发hash推断模型完整读过每份材料；该历史AI稿遗漏V2/旧返工史且未披露截断，教学整编未全过。须检查可见范围、缺口和学生纠正新版本。文末M17–M25保留各自当时的历史状态；最新结果见配套《AIDT V2 完整测试报告》，不把历史prepared或本地模板代替真实模型证据。

预期：每组一份可编辑可审阅报告；AI草稿不自动成为结论，不自动保存/归档。来源可定位，缺失研究/点评不虚构。导出内容与学生保存/审阅的版本一致。

| 状态 | 报告版本/AI来源/缺口/导出文件 | 证据 | 缺陷/阻塞 |
| --- | --- | --- | --- |
| □通过 □失败 □待测 □阻塞 | __________________ | __________________ | __________________ |

### H11 · FR11 双账号、跨端、全界面成员文字插件

前提：A/B是两个真实会话，均属甲；C属乙。

1. A在第一步打开现有成员文字插件发送主频道消息，B读取并回复；B发另一主消息，A在对应单层话题回复。
2. 在每个界面打开/关闭插件：小组总览、第1–6步Chat/本步成果、阶段交接、材料、报告、原生Design。逐项记录可用范围；明确未集成页面则记录缺口，不只看按钮存在。
3. 分别留主频道未发草稿和话题未发草稿，关闭/重开、换步/返回；核对两份草稿不互换、不覆盖AI输入框。
4. 切到乙，再回甲；确认不显示另一组消息/草稿。C/匿名访问甲消息、话题与发送入口应拒绝。
5. A/B退出重登录，刷新甲；核对两根消息和交叉回复的作者、话题归属与文字未重复。网络失败重试不产生重复消息。

预期：人类成员消息与AI对话明确区分，发送给成员不触发模型生成。话题尚未加载时回复框不可提前接受错误频道输入；归档/撤权及时变只读，不被迟到历史响应恢复可写。线上与同屏看到同一共享版本；不宣称已实现语音房或实时合并策略。

| 范围 | 状态 | 实际结果 / 证据 |
| --- | --- | --- |
| 总览与六步 | □通过 □失败 □待测 | __________________ |
| 材料/交接/报告 | □通过 □失败 □待测 | __________________ |
| 原生Design | □通过 □失败 □待测 | __________________ |
| 草稿/频道/话题 | □通过 □失败 □待测 | __________________ |
| 双账号与隔离/重登录 | □通过 □失败 □待测 | __________________ |

### H12 · FR04 / FR11 并发CAS、断网、重试与归档只读

前提：只使用练习组，A/B均读到同一步服务器V1。

1. A先保存V2；B保留基于V1的不同编辑并提交。
2. 检查B收到冲突而非成功：本地文字仍在，服务器仍是A的V2，未静默覆盖。
3. B明确比较并选择基于服务器继续编辑，再保存为V3；读取历史V1/V2/V3。
4. 临时断网提交另一草稿，观察真实失败并保留本地文字；恢复网络后主动重试，检查真实回执与版本，不把旧错误清除等同成功。
5. M归档练习组，A/B刷新后表单/发送/保存只读；服务端直接写入也应拒绝。重入可读旧成果。M解归档后再核对恢复权限和原稿。
6. 如测试中已有AI消息A失败，在输入框另写未发送的B并加入新附件/活跃引用，分别检查错误横幅和运行记录的“重试”：必须仍重发A的原文、原附件及冻结来源，保留B全部草稿；随后正常发送B时再清稿。仅在本地回环环境或已明确批准模型费用的环境操作；没有可用失败状态则标阻塞，不为本项擅自新增付费任务。

预期：真实CAS拒绝、学生显式选择后重试，失败不丢稿不重复；匿名、非组员及归档写入边界均由真实服务执行，不靠前端隐藏按钮。

| 状态 | 冲突版本/失败重试/只读结果 | 证据 | 缺陷/阻塞 |
| --- | --- | --- | --- |
| □通过 □失败 □待测 □阻塞 | __________________ | __________________ | __________________ |

### H13 · FR12 教师授权进度与点评（P1）

1. T只进入获授权课程，查看甲各步已保存成果与当前进度；访问未授权课程应拒绝。
2. T给出一条明确署名/时间/来源的点评，学生可查看；报告只能汇集实际已存在的点评。
3. 检查没有首版评分或自动教学判定。若教师入口未交付/授权待签核，直接记录阻塞/未实现。

| 状态 | 实际结果 | 证据 | 缺陷/阻塞 |
| --- | --- | --- | --- |
| □通过 □失败 □待测 □阻塞 □约定后置 | __________________ | __________________ | __________________ |

### H14 · FR13 学生自主叙事展示（P1）

1. 学生自行选故事结构、保留/舍弃的证据和学习重点；AI建议不能自动替学生定叙事。
2. 审阅可编辑展示材料与来源，导出后打开实际文件。
3. 自动PPT范围待确认；HTML/Markdown/PDF不能称为已生成PPT。未实现记缺口。

| 状态 | 实际结果 | 证据 | 缺陷/阻塞 |
| --- | --- | --- | --- |
| □通过 □失败 □待测 □阻塞 □约定后置 | __________________ | __________________ | __________________ |

### H15 · FR14 一键打印与3D文件（P2）

1. 对实际交付的打印入口发起打印并检查实际打印/另存产物。
2. 只有本轮明确交付3D功能时才检查格式、可打开性、设备与成本；不能用静态图片/PDF冒充3D文件。

| 状态 | 实际结果 / 本版范围决定 | 证据 | 缺陷/阻塞 |
| --- | --- | --- | --- |
| □通过 □失败 □待测 □阻塞 □约定后置 | __________________ | __________________ | __________________ |

## 4. FR01–19 索引

| FR | 对应人工用例 | 人工最终状态 | 证据编号 |
| --- | --- | --- | --- |
| 01 | H01 | __________ | __________ |
| 02 | H02/H09 | __________ | __________ |
| 03 | H03/H10 | __________ | __________ |
| 04 | H02/H03/H12 | __________ | __________ |
| 05 | H04/H08；录音语音另排 | __________ | __________ |
| 06 | H04/H05/H08/H10 | __________ | __________ |
| 07 | H06 | __________ | __________ |
| 08 | H07 | __________ | __________ |
| 09 | H08/H09 | __________ | __________ |
| 10 | H10 | __________ | __________ |
| 11 | H02/H11/H12 | __________ | __________ |
| 12 | H13 | __________ | __________ |
| 13 | H14 | __________ | __________ |
| 14 | H15 | __________ | __________ |
| 15 | H03 | __________ | __________ |
| 16 | H05 | __________ | __________ |
| 17 | H06 | __________ | __________ |
| 18 | H07/H08 | __________ | __________ |
| 19 | H08/H09 | __________ | __________ |

## 5. 独立机器测试记录（不是人工签核）

历史记录起点：2026-11-16。后续运行追加，不改写失败证据。M01–M25 及其下方说明保留各自运行时点的范围、限制和失败；其中“本次”“未执行”仅对应原时点。当前修复结果见 M26。对应历史工程矩阵见 [FR证据矩阵](./v2-fr-evidence-matrix.md)。

| 机器证据 | 实际执行与结果 | 能证明什么 | 不能证明什么 |
| --- | --- | --- | --- |
| M01 · Native N08 | `aidt-local-persistence.spec.ts`真实浏览器1 passed；两轮启动/停止；13预约端口全部释放；完成标志true | 已保存S1/S3/S4/S5/S6与报告历史；合法返回1–5、错误/缺失返回可恢复；匿名拒绝；真实双账号消息及重启恢复 | 没有模型请求、没有真实研究、没有生成原型；不证明V2全量或人类已验收 |
| M02 · Native N09 | root已核验同类原生双cycle通过；最终交付时附独立运行证据 | 原有原生持久化流程复验 | 不自动扩大为新增课程/上传/真实Agent功能覆盖 |
| M03 · V2小场景首次运行 | 实际3失败，未到模型请求；冷编译导致登录/建组导航先于默认断言超时，复杂页面首编约70秒 | 暴露冷启动与测试导航等待差异，失败已保留 | 不表示真实Agent失败，也不能计为通过 |
| M04 · V2新小场景第二次运行 | 实际3失败：真实登录POST已200，随后Web空响应并停止，后两场连接被拒绝；没有模型请求 | 识别真实服务可用性故障，保留脱敏失败证据 | 未进入Agent/阶段场景，不能判这些业务通过或失败；`--list`/ESLint/类型检查不等于浏览器通过 |
| M05 · 提供方连接 | A1实际模型连接HTTP200、非空、18 tokens | 当前提供方连接可达 | 模型直连不等于应用内Agent端到端、Skill挂载或教学质量 |
| M06 · 新功能逐项证据索引 | 原型见M09；真实材料与描述单见M13/M14；报告引导师收费运行仍阻塞 | 仅各证据明确覆盖的功能与边界 | 不能把单项绿合为完整V2，也不能用组件受控测试替代实际上传、生成、导出或Agent运行 |
| M07 · V2第三至五次运行 | 第三次QA同源API接线错误已修；第四次S1在计费调度前失败且中断；第五次**两项通过、一项失败**，A1核出持久用量spool配置缺失，同样在供应商调用前失败 | FR16材料关联found/none与历史回读、断网重试、CAS冲突、匿名拒绝、归档只读已真实通过；两次S1真实终态失败均保留，供应商0由独立日志证据确认 | 没有有效Agent回复，不能判引导师完成；未知调用与收费仍占预算，不能自行返还或自动重发 |
| M08 · 真实S1原运行恢复 | funded技术actor原运行等待任务确认而超时，恢复时学生发现AI错认阶段并通过原生“改假设”纠正；**同run机械流程恢复1 passed**，没有新增S1消息/运行；该run内部实际5次模型请求、33647模型tokens、5条结算回执 | 确切Skill pin、真实问句、学生回应重写主题与保存/新登录机械链路；原超时与错误保留 | 已确认原桥接丢弃TeachingContext，不能称S1已读取组保存材料；一个run不等于一次completion；不证明普通学生资金或权限已满足 |
| M09 · A5真实静态原型两版 | 2次真实Design POST，V1/V2均source=model，immutable seq1/2与实际frame文字可见；旧问题/版本冻结和新版关系保存重载通过；实际4次模型请求、13707模型tokens、4条settled | 静态原型真实生成/版本与已检查范围；既有测试余额扣费、无新充值/角色变更 | 不证明交互功能、真实用户测试/研究成功、普通学生资金条件；最新scope修复须最终产物复验 |
| M10 · Web回归 | 协调者统一核对的812项Web回归通过，初次4项红测与修复证据独立保留 | 这些回归在其指定层级通过 | 不是实际供应商/完整V2 E2E，也不代替人工签字或未实现的新服务端回执 |
| M11 · 全界面成员文字 | 实际浏览器1 passed（18秒）：总览、六步Chat/成果/交接、sources、report、原生Design共22处 | 真实主频道/单层回复可读；两份未发草稿跨步关闭重开保留；进入Design前真实填写/确认/保存S5问题；巡检不改变保存稿、未触发Chat/Design模型请求 | 角色是既有未funded setup admin，不单独证明学生角色权限；空Design没有生成；不代替课堂实际沟通质量 |
| M12 · FR01课程 API-only | A2真实HTTP 17项检查通过：课程持久化/同操作幂等/不同输入409、普通学生创建403、课程元数据不等于加入小组、非成员读组404；模型请求0 | 本次实际API课程与授权检查，无组织角色或项目成员变更 | 这份证据没有操作课程UI。后续UI初验三红与修复后复验三绿另见M16，不以API证据代替UI |
| M13 · 原件/发现卡/持久描述单图 | 新生产产物实际1 passed（7.2秒）：文字/PNG真实上传、SHA与原字节/真实来源头回读、发现卡原话/学生解释/AI推测独立、非组员404、离线重读显式重试且无再上传；三张不同点子原图保存重载后三次真实beforeprint图片均已加载 | 本次实际上传/授权/共享回读、三份独立原生打印事件，Chat/Design模型请求0 | 合成材料不是研究；setup管理员不替代普通学生授权；未实际另存PDF文件 |
| M14 · 临时预览/分类/打印边界 | 首次因QA误期望自动剥离本地图片而失败，修正操作顺序后单场1 passed（3.1秒）：先存文字/多标签/选择，再加临时图；共享保存明确报图片引用错误且无PUT/服务器不变，重新审阅后三次真实beforeprint图片均已加载 | 临时图未被冒充为持久原件；保存/分类/拟选择与临时打印边界实际核验，旧失败保留 | 临时图没有跨重登录保存；未实际另存PDF，人工H06仍须核验输出文件 |
| M15 · 最终同源原件只读复验 | 最终`4bfb82e268a618d57af25e5596a11ddc04cf38cf`生产产物：原账号正常登录，复用M13已保存的文字与PNG，两次同源GET200，逐字节/SHA/版本/上传者与时间头精确一致；旧S2成果前后逐字不变 | 新增精确原件rewrite没有改变本次已存原件读取行为；登录后写入0、新上传0、模型请求0，浏览器已关闭 | 只复验两份旧原件读取，不把M13/M14改标为新源码，也不证明完整V2或实际另存PDF |
| M16 · 最终课程真实UI | A2在最终`4bfb82e268a618d57af25e5596a11ddc04cf38cf`生产产物实际3 passed（15.4秒）：建课/关联真实组、同课双组隔离与新登录；归档组读取/拒绝新绑定；真实分页与离线明确重试。浏览器已关闭，重试0、模型0、收费总账前后hash一致 | 本次课程入口与真实普通成员/管理员角色边界；同源rewrite修复后UI可达 | 初验final01三红保留，不能删除或写成从未失败；课程不是自动入组，不是教师角色验收，也不代表完整V2或人工签字 |
| M17 · 已批准桥接无供应商费用集成 | 最终22/22真实PG通过（20.71秒）：实际授权来源/原子快照/ModelCall历史槽/Deep适配器实际本机HTTP消息hash/receipt一致，拒绝与撤权竞态、旧快照恢复、SUM缺口、S6旧源、普通Chat零AIDT副作用；3源显式TS诊断0 | 可证明本次真实数据库、受理事务、实际适配消息和来源回执的对应；本机协议HITL恢复与旧派发事实迟到不回退，全部测试资源已清理 | 供应商调用0；本机协议记录服务不是实际LangGraph/模型推理；该PG证据本身不证明浏览器或收费Agent；后续实际M18–M22另列，原S1错误/环境红/QA红均保留 |
| M18 · 真实浏览器仅受理检查 | 修复前`696e5da`/context-02首场1 failed（8.716秒）保留；修复后`741bc9f69`/context-03原单场**1 passed（4.7秒）**：真实保存/SDK一次/strict坐标/原文/pin/queued、独立HTTP prepared回执及UI初始折叠不请求→展开真实读取/可见hash、真实cancelled全部通过 | A1独立SQL确认精确S1V1/S2V1、真实snapshot、application0；浏览器已关闭，physical/usage/credits/holds/unbounded/active全0，资金与旧预算hash不变 | 仅prepared受理和读取通过，未组装、未派发、未模型消费；actor为既有未funded管理员+本组owner，不证明普通学生付费权限；QA旧refs增量另记hash，不冒产品构建SHA |

| M19 · 本次新增S1真实任务 | 产品API/Web `c361ba55b`，额外独立最多1账本；首启动器因grep错误0测试失败保留；修正后真实1 passed（17.7秒，整场18.7秒），S1V1来源冻结/真实派发、学生回答与方向选择、正式主题重写保存V2及新登录精确回读；1 physical、10065 tokens、settled 10.07测试credit | 来源机械链、实际Skill pin与快照/派发hash、学生保有保存决定；A1/A2独立核V1未被head V2替换 | 基础Agent实际仍是core-loop echo测试夹具；实际追问含3问/多个分支，单一追问行为失败。机械退出0不等于教学通过或普通学生资金通过 |
| M20 · 本次S2真实任务中断/取消 | 4次无native发送的QA前置失败保留；第5次唯一发送run `8a4188ab…`，源S1V2/S2V4与真实原件/卡片通过；基础echo夹具把任务误认成原样回显，测试未批准/编辑该卡，随后按正常API取消。1 physical、8222 tokens、settled 8.23测试credit，holds/active/unsettled均0 | strict来源、实际派发与拒绝错误任务确认；原件/卡片及失败预算未被清空，旧run不可变 | **S2 Agent未成功**，没有AI后采纳、正常教学回复或完整同组链。新run不可借旧额度自动重发；S3–SUM及本次新增Design两任务均未运行 |
| M21 · S2人工fallback清单PDF | 新Web `ec5ff2e9d` / API `c361ba55b`，0费case首轮通过（4.2秒）：学生明确写“本次AI任务未成功，人工自行修订”，保留原提纲，主动保存V5；实际beforeprint仅采纳字段；Chromium从真实打印DOM副本生成PDF字节，解析正文且字体嵌入/实际渲染可读；新登录一致 | 真实PDF文件可打开、原稿未混入；旧S2 run快照仍V4；phase历史不改，模型/Design请求0 | 不是AI采纳成功、不是操作系统“另存为”对话自动化，不是访谈已经开展；不代替三份点子PDF或人类签字 |
| M22 · S6独立测试原件入口 | 同新Web，0费case首轮通过（4.8秒）：独立合成组上传TXT反馈与PNG示意图，实际201/原字节/SHA/来源头/图片decode/共享保存V1及新登录全部通过；真实同org consultant非组员的阶段与原件404，owner错误project也404 | 第6步真实文件入口、持久引用与访问隔离；两case总2 passed（10.1秒），A1独立证明physical/usage/credit总数未新增、预算双hash不变 | 独立组没有原型/问题快照/学习确认，不捏造版本，不能称完整S1–S6/SUM或真实用户测试；PNG明确是合成图，不是测试照片 |

| M23 · 测试基础指令修复 | 私有隔离测试实例已追加一个不可变版本，逐字复用产品已有默认助手指令；只切换该测试Agent默认版本指针。A1独立核旧版本、消息、运行、来源快照、权限及资金15组数据和两份账本均不变，新增模型调用0 | 错误echo基础指令已在测试实例纠正，未来真实AIDT测试启动也改用现有默认指令；原失败保留 | 这是测试数据准备，不是普通发布API通过，也不是修复后S2教学重验通过；后者需补充一次S2任务额度 |
| M24 · 补充授权S2实际任务失败 | API `adbb21d0e` / Web `ec5ff2e9d`；picker前置红及零SDK诊断无新增费用。14:20:46唯一native逻辑发送，run `40539aa6-2732-4661-9665-913013af806d` 为 `failed / MODEL_CALL_FAILED`，6.9秒退出1；独立max1已占、旧两账不变、S3未解锁 | 精确S1V2/S2V5与单approved `aidt-empathize`；浏览器早期assembled与后续14:20:48.750派发/hash独立核对均保留。[旧网络HEAD](../a1/s2-supplement-20261116/one-head-old-network-contract.json)复现SSLverify19：restore漏3项可信CA且覆盖NO_PROXY；`5df77b477`窄修转发CA并保留NO_PROXY大小写，5项离线测试通过；[修后HEAD](../a1/s2-supplement-20261116/one-head-fixed-network-contract.json)开TLS校验收到HTTP404，只证HTTP连接通，两次HEAD均无auth/正文/模型 | 无assistant/意图卡/学生后续保存/新登录，不记教学或机械全链通过，额度耗尽未重发。2次物理请求、2条failed用量；`total_source=unknown`，0是占位而非零用量；2笔pending占款86.29测试credit未结算。[私有诊断备份核对](../a1/s2-supplement-20261116/post-failure-diagnostic-financial-verification.json)保全failed/pending/第三账，非zero-outstanding可恢复；HTTP404不证明模型成功或费用已定，不退款或清账 |
| M25 · 零模型费用后续回归 | [本机TLS/SDK对照](loopback-openai-tls-machine.json)使用临时CA、真实HTTPX/AsyncOpenAI与仅loopback故障桩；旧profile验证失败且服务端无HTTP请求，新helper CA后HEAD及canned SDK响应成功，均非真实模型。既有env5项加两项loopback共7项；[草稿修复](../../zero-cost-followup-20261116/a4/failure-draft-review.md)25项定向通过、完整Web类型检查0 | `c9cf6ebb7`重试A保留B正文/活跃引用/新附件，A原文/id/来源仍冻结，正常发送B再清稿；私有有界异常诊断12项离线测试含实际内存poll/SSE，公开error/事件逐字不变，不输出原文/URL/密钥。原始备份限定取证已完成，细节见[因果审阅](../a3/s2-causality-followup.md) | 旧profile HEAD系按当前工具env重构，非原S2历史进程指纹；受控机制因果已证，原S2底层cause未保留，不能追认唯一根因。mock canned响应不证明供应商或教学通过；原S2仍失败，最后在线14:38:14 UTC的两笔unknown/pending占款86.29保持，未结算、未重发 |

### M26 / 后续修复专项与实际复验

[本轮完整测试报告](../../remediation-20261117/test-report.md)分别记录修复后的真实模型、原生浏览器、保存与版本、双账号成员文字、报告导出、独立语义审阅、环境阻塞和实际计量。原失败与新复验分别留档；报告明确哪些已经执行、哪些仍跳过或待人工验证。另附合成成果样本，不能作为真人访谈或课堂效果证据。此索引不代填任何 H 用例或人类签字。

以下 M01–M25 说明为历史原文，状态仅对应其记录时点。

M24来源为[补测执行说明](real-completion-20261116/s2-supplement-execution.md)、[零SDK诊断](real-completion-20261116/s2-supplement-picker-zero-model.json)、[实际执行记录](real-completion-20261116/s2-supplement-attempt02-execution.json)及[实际附件](real-completion-20261116/s2-supplement-attempt02-attachments.json)。QA为运行时增量，不冒称全部已在上述产品commit。原M20失败/取消与M21人工fallback保持原义；修复基础指令不等于S2成功。prepared snapshot为`326557fd…723968a`，当时assembled hash为`e9527c82…73a6f6`；该早期浏览器回执没有派发观察时间，后续[A1计量](../a1/s2-supplement-20261116/native-failed-accounting.json)和[A2来源审计](../a2/s2-supplement-audit-20261116/actual-failed-run-report.json)独立确认稍后实际派发，保留两时点区别，仍不推断供应商已成功采用。执行器已关闭、active为0，财务pending原样保留。S3–S6/SUM和本次新增Design任务未启动，普通学生付费权限及人工教学验收仍未证明。

M07详见工程证据`a6/v2-attempt05-machine.json`。原七次跨进程账本不重置；本次S2唯一任务已经占用旧额度，虽取消仍保留费用，旧账现有效已占两次（含旧S1），剩余五次不是S2自动重试许可。新增S1使用独立最多一次的补充账本，已用一次。本次新授权的两个Design任务尚未使用；M09是历史另一轮两版实证，不能当本次同组原型通过。人工教学质量仍由本手册实际操作与签字决定。

M08独立脱敏来源为`a6/v2-s1-existing-run-machine.json`与`a1/native-s1-settlement.json`；M09来源为`a5/real-design-funded-result.json`、`a5/real-design-v2-frame-result.json`与`a1/design-real-accounting.json`。保留原卡、学生修改和实际记录；来源契约本轮已获批准；后续阶段在接线及无费用反例验证通过前暂停收费，不靠重发模型掩盖缺陷。

M11来源为`a6/global-member-text-surfaces.json`；其前两次QA selector/进入Design前提错误独立保留，最终通过没有删断言、延长等待或绕过验证问题门。

M12来源为`fr01-course-entry/course-api-after-filter.json`，明确标为API-only，不能代填H01人工结果。课程UI初验失败与修复复验由A2另列，不能用API通过覆盖。

M13来源为`a6/v2-raw-materials-and-print-machine.json`；M14来源为`a6/v2-local-preview-and-print-machine.json`。生产产物源码为`7235b9cdcfea2774df913035cb3f2109504213ad`；M14只修QA操作顺序，未改图片保存契约或产品。原生beforeprint与实际另存PDF字节是不同证据，M13/M14均未交付浏览器保存的PDF文件。

M15来源为`a6/v2-final-rewrite-original-readback.json`；用M13相同真实组与保存引用核对，不重建素材或替换旧证据源码标识。

M16由A2实际执行并经协调者确认；[课程最终证据索引](../../fr01-course-entry/course-final-index.json)列出`course-ui-final-01-summary.json`三红、`course-ui-final-02-summary.json`三绿及`course-ui-final-02-attachments.json`完整三场实际附件。P3缺口仍保留：创建项目回执缺少`provenanceEventId`，未伪造该值。H01实际结果与签字仍由人类填写。

M17来源为`a6/bridge-real-pg-machine.json`及[执行说明](./bridge-real-pg-verification.md)。执行时工作树尚未统一提交，文件hash与原基线已留存；后续桥接落入`b8e27049e`，不将其伪装成此前运行SHA。22绿包括回执最后增量；此前21绿与环境/夹具失败分开保留。

M18初次红保留在`a6/context-prepared-browser-machine.json`，最终绿见`a6/context-prepared-browser-final-machine.json`，并关联A1的`context-stack03-prepared-run.json`、`context-stack03-prepared-actor.json`和`context-stack03-after-browser.json`。context-03仅按修复后明确授权复验一次，重试0；旧预算未重置、执行保持关闭。新坐标/回执QA helper另有25项零网络单元检查，其中保存旧refs与head不同时仍独立期望旧版；单元绿与真实浏览器实证分开记录。

M18使用的context-03栈已由A1正常关闭，`context-stack03-final-receipt.json`确认自有容器/卷、13端口和预约均已释放。M19–M22另用独立context-04；是否仍运行及最终清理由A1最后回执说明，不以旧栈清理证据冒充新栈已关闭，也不在交付文件公布临时私密配置或身份。

M19–M22的实际附件统一位于[a6本次同组实证](./real-completion-20261116/README.md)。S1机械通过与单一追问失败分别记载；S2中断/取消、4次零发送前置红和启动器0测试红全部保留。独立[A3内容审阅](../a3/real-completion-content-review.md)与[A2来源只读审计](../a2/source-audit-20261116/s1-report.json)不代填人工结果。

M21实际文件为[学生人工修订访谈清单PDF](./real-completion-20261116/student-manual-interview-guide.pdf)，由真实产品打印文档副本经Chromium生成；与本手册PDF是两个不同文件。M22非成员身份已通过正常登录与真实identity GET核为同org consultant，没有改角色或入组。两项免费case前后收费账本SHA不变，A1独立回执见`context-stack04-free-deliverables-after.json`。

M19–M25历史身份说明：当时已有合法测试余额的管理员用于模型链路验证，未充值、改角色或提升课程/组织plan；这不证明普通学生已有模型额度或相同权限。当时的独立只读检查显示该普通学生测试账号可用余额为0，其资金前提尚未满足。H03/H10的真实学生人工结果仍保持空白，须在学生实际授权与合法额度到位后操作；管理员模型通过不得代填。

新V2真实Agent验收使用显式启用的专属lane，默认CI不运行；普通确定性模型lane不能代表它已测。未运行、skip或静态检查均不能计为真实通过。

机器证据只附脱敏副本。私密运行身份文件、配置、原始trace、密码页快照和令牌不得进入PDF或分享包。

## 6. 缺陷与阻塞登记

以下为 M01–M25 历史检查点的问题原文，其后续处理见 M26 与本轮报告。人工操作者应记录自己实际遇到的问题。历史机器记录：S1实际多问未满足单一追问；S2基础echo测试夹具冲突，任务已取消而非成功；S3–SUM及本次新增Design两任务未执行；三份点子实际PDF字节仍待本次完整链验收。S2人工清单PDF与S6独立原件虽已通过其机器范围，不能消除上述缺口。


| 编号 | FR / 用例 | 复现步骤与前置版本 | 预期 / 实际 | 严重度 | 证据 | 负责人 / 状态 / 复验 |
| --- | --- | --- | --- | --- | --- | --- |
| D____ | __________ | __________________ | __________________ | ______ | ______ | __________________ |
| D____ | __________ | __________________ | __________________ | ______ | ______ | __________________ |
| D____ | __________ | __________________ | __________________ | ______ | ______ | __________________ |
| D____ | __________ | __________________ | __________________ | ______ | ______ | __________________ |

已知边界须在本轮复核：正式课程关系是否交付；独立材料上传和可读文件是否接通；原生打印是否实际另存PDF；真实Agent报告/原型是否生成；教师/展示/打印P1/P2范围是否由负责人确认；录音语音另排。任何待签核项只能记录待确认，不能由测试者或Agent代签。

## 7. 人工验收结论与签字

| 项目 | 填写 |
| --- | --- |
| 本轮通过用例与证据范围 | __________________________________________________ |
| 失败、未测、阻塞及本次明确排除项 | __________________________________________________ |
| 教学适切性：学生是否保有方向选择与讨论主导权 | __________________________________________________ |
| 是否允许下一步试点（不是生产发布） | □允许　□修复后复验　□不允许；理由：________________ |
| 学生试用者签字 / 日期 | __________________________________________________ |
| 测试负责人签字 / 日期 | __________________________________________________ |
| 课程负责人签字 / 日期 | __________________________________________________ |
| 设计签核引用（如适用，由有权人填写） | __________________________________________________ |

本页签字仅代表上述明确范围内的人工验收，不自动改变仓库设计签核、后台权限、发布状态或课程完成状态。
