# AIDT V2 FR01–19 用例与证据矩阵

需求来源：[用户完整 V2 Markdown](../../../../requirements/aidt-v2-full.md)，root已原样落库并核对72091bytes；FR15–19 的新增摘录另见 [aidt-v2-delta](../../../../requirements/aidt-v2-delta.md)。本矩阵是验收索引，不是新增需求或设计签核。

状态只认实际运行：`已通过`必须有当前源码对应的浏览器/服务证据；`已编写`仅表示可发现的测试文件；`待接口`不作为通过；`后置`保留用户明确优先级或决定。

| FR | 用户可见行为与关键断言 | 验收场景/事实来源 | 当前状态与缺口 |
| --- | --- | --- | --- |
| 01 | 课程/小组/成员关系，所属组入口，双组隔离，新登录重入 | V2-C1；A2真实课程UI；`fr01-course-entry/course-api-after-filter.json`与`course-final-index.json` | API-only 17项通过；final01三场UI因rewrite缺失失败并保留；修复后最终4bfb产物final02三场真实UI全部通过（15.4秒、0重试/模型），含真实普通成员边界、双组隔离、新登录、归档/分页/离线重试。P3创建项目回执缺provenanceEventId保留；人工H01未签字。 |
| 02 | 六阶段当前成果、保存状态、返回保留旧成果 | N08双cycle、旧V1/3/4/5/6对比headV8 | 原有范围已真实通过；V2新字段需按小场景再验。 |
| 03 | 一个引导师按阶段Skill及已保存组上下文追问，学生先输入/决定 | M17 PG22、M18 prepared、M19/M20本次真实S1/S2、A2来源审计 | 本次S1来源组装/派发与学生主题保存/新登录机械链通过，但实际追问3问且基础Agent为echo测试夹具，教学单一追问失败；S2精确S1V2/S2V4真实派发后错误理解为回显，未批准该卡并安全取消，不能计成功。S3–S6/SUM本次未运行。旧drop失败、prepared红/绿与本次真实费用分别保留。 |
| 04 | 想法、讨论结论、选择理由可编辑、共享保存、重进 | CAS原实证；M19学生主题初稿V1→正式V2；M21人工fallbackV5 | 原有CAS/断网/重进通过；本次S1学生实际问题回答、分歧/方向选择/主题重写后保存V2与新登录通过。S2人工自行修订保存V5明确AI未成功，phase历史不改，不算Agent采纳完成。 |
| 05 | 文字/图片材料上传与来源阶段关联；录音/语音另排 | 原M13/M15；本次M20原件/发现卡；M22独立S6真实TXT/PNG | 既有S2真实上传/字节/来源头/非组员/离线重试已过。本次S6新入口实际上传TXT+合成PNG、原字节/SHA/提交者与时间、decode/共享V1/新登录通过，同org真实consultant非成员404与错project404。S2孤立TXT恢复为真实API GET+stage PUT fallback，非全程UI恢复；未重POST。录音/转写后置。 |
| 06 | 原始证据/学生解释/AI推测分开，洞察关联或待验证 | V2-E1/FR16发现卡与历史来源 | 图片/原件引用、原话逐字、学生解释与独立AI推测字段的真实保存回读通过；文本/卡片关联历史此前通过。推测字段是明确合成夹具，不声称本场调用了模型或做过真实访谈。 |
| 07 | 选择/投票边界；至少三不同点子，名称/图/2–3句描述单/PDF | V2-I1；N08多标签与选择分离；M13/M14 | 三不同点子持久图片与临时图两条路径、逐份真实beforeprint/独立ideaID/图片已加载均通过；本地bytes共享保存明确拒绝且server不变。原生选择不是投票；实际另存PDF字节仍由人工H06核对。 |
| 08 | 原型类型、界面文字/可选参考图及历史上下文→静态方案→选择修改与版本 | V2-P1，A5 native Design实际POST与GET version | A5 funded技术actor实际2次POST、V1/V2 source=model与immutable seq/可见内容通过；不证明学生资金权限或真实研究。最新scope修复仍需最终产物复验。 |
| 09 | 反馈对应原型版本，反思认识与返回，按需新版 | 原N08/A5旧原型链；本次M22独立测试材料入口 | 历史返回与旧原型关系范围保持原证据。本次新增S6原件入口TXT/PNG真实保存/回读/隔离通过；该独立组没有原型或问题快照，不捏造版本，不能称本次完整反馈→原型→认识变化链已过。 |
| 10 | 小组报告串联问题/证据/创意/原型/测试/已有点评，审阅编辑导出，缺失不造 | 原报告持久化历史；PG SUM来源22场；completion SUM已编写 | 本次同组链在S2错误echo基础角色处中断；SUM真实浏览器/供应商任务未运行，不能用S1机械派发或S2人工清单PDF代替报告引导师。新SUM用例要求六步真实来源+旧S6 confirmed反思、独立summarypin/receipt、人工段保留/来源冻结/精确Markdownbytes与新登录，当前仅QA准备。教师点评来源仍缺失。 |
| 11 | 线上线下同组共享成果，多端隔离与冲突 | V2-B1、全界面22场景；N08双账号跨重启 | V2 CAS/网络恢复/只读与22处全局文字插件真实通过（setup admin）；N08成员互发/幂等/重启通过。学生角色课程隔离由A2独立用例另验；实时合并/会议规则待定。 |
| 12 | 教师授权进度与点评，不评分 | 教师授权/已有点评入口 | P1后置；不编造教师点评或用管理员替代教师验收。 |
| 13 | 学生自主叙事展示 | 学生编辑报告与现有导出 | P1；自动PPT待定，不把HTML/Markdown称PPT。 |
| 14 | 打印/3D | 现有打印/导出边界 | P2后置；PDF导出不等于3D。 |
| 15 | 原命题/价值/来源反思→学生回答追问→正式主题与选择 | M19真实S1同组任务与A3内容审阅 | 本次实际保存V1来源、真实回复、学生回答/分歧/方向/主题重写V2与新登录通过，A1核1physical/10065tokens/10.07测试credit settled。单一追问行为false：回复追问段含3问；base echo夹具冲突保留，不把机械1pass或管理员模型actor当学生教学/资金通过。 |
| 16 | 画像前意外发现或显式暂无，关联材料和具体来源版本，保留矛盾/例外 | V2-E1：S2材料V1→S3foundV1→noneV2→历史精确回读 | 文本/卡片关联小场景真实通过；照片上传在最终产物另验。 |
| 17 | easy/breakthrough/fun可多标签、确认与选择分开、不凑三类配额 | V2-I1；N08学生修分类会取消确认，选择保留 | 多标签easy+fun与拟选另一候选真实保存通过；三份独立真实print通过，实际PDF另存文件仍待人工验收。未要求三类各一项。 |
| 18 | 先写/确认本轮问题，生成绑定真实版本，修改取消确认，保存先前认识 | V2-P1；N08未确认不开放生成、确认快照与S6带入 | 原有问题门槛与A5真实静态两版本/问题快照通过；新scope修复需最终产物验证，不将技术账号替代学生权限。 |
| 19 | 测试后认识变化/不变/不足，返回1–5或未决定、旧版保留 | 原N08；A2新增真实PG return-only7；M22独立原件 | 原返回/历史证据保留；A2另7/7真实PG核合法旧confirmedreturn与6拒绝，0provider，不能冒browser收费完整链。本次S6文件入口零模型通过但无原型/学习确认；本轮S6 Agent/新2Design尚未运行，不强制回1–4先生成新版，合成反馈非真人测试。 |

## 本轮小场景入口

- `apps/web/playwright.aidt-v2.config.ts`：只连接A1已有预约栈，不启动服务；零重试、串行、关闭可能记录凭据的原始trace。
- `apps/web/e2e/aidt-v2-student-journey.spec.ts`：学生先输入→真实原生Agent→学生确认→实际保存；FR16found/none；真实CAS、匿名与归档只读。
- `apps/web/e2e/support/aidt-v2-acceptance.ts`：实际浏览器会话鉴权、契约解析、真实Skill挂载、durable run/message关联；真实失败终态及时退出。
- `apps/web/e2e/aidt-v2-completion.spec.ts`：同一project的逐任务真实链，显式单phase授权，旧phase/失败不清零；本次实际仅S1机械通过、S2中断取消，后续未运行。
- `apps/web/e2e/aidt-v2-deliverables.spec.ts`与`playwright.aidt-deliverables.config.ts`：专用0模型两场，S2人工fallback真实PDF字节/S6独立TXT+PNG原件与同org隔离，本次2 passed。
- `apps/web/e2e/support/aidt-v2-supplemental-ledger.ts`：本次新增S1独立最多一次账，与旧七次账本不同路径，不将旧7改8；已用一次。
- `apps/web/e2e/support/aidt-v2-run-ledger.ts`：跨进程持久总账，六阶段+SUM最多七个可能收费的原生Agent运行；未知失败计入、不自动重试，成功/失败均保留，只有实际供应商未调用证据才能由root核对单列。A5另获授权的两次Design生成单独记录。

## 原有实证边界

N08 `/workspace/scratch/aidt-completion-acceptance/attempt-full-08/results/persistent-roundtrip.json`：`completed=true`、`nativeStartStopCycles=2`、13条`leasePortsFree=true`，双方消息及报告历史跨重启恢复。该lane `generationRequests=[]`、真实研究/生成原型均为false。N09由root核验同类通过；不将外部补充Design脚本启动检查失败记为产品失败或通过。

## 运行前提与证据判决

由A1提供真实隔离栈及`REAL_MODEL_E2E_EMAIL/PASSWORD/BASE_URL`、`AIDT_V2_API_ORIGIN`、实际`WORKSPACEX_ISOLATION_ID`，显式`AIDT_V2_REAL_AGENT=1`。只接受127.0.0.1；不猜凭据或端口。缺配置直接失败，不skip补绿。

独立真实lane入口：准备上述私密环境后运行`pnpm --filter web exec playwright test --config playwright.aidt-v2.config.ts`。默认CI不运行本专属lane；确定性fullstack仅精确排除此新文件，不改其他用例或模型。显式选择此lane后缺配置失败，不将未运行/skip计为真实通过。

真实模型自动断言只证明请求/Skill挂载/运行成功/消息落库/学生保存权；追问教学适切性与课堂成果仍需人工审阅。实际模型提供方需与A1供应商实证及run记录关联。所有访谈/照片测试夹具写明合成，不证明发生过真人访谈。

## V2 实际运行记录

| 运行 | 实际结果 | 精确差异与处理 | Agent请求 |
| --- | --- | --- | --- |
| attempt-01 | 3 failed | 冷编译：登录/建组默认URL断言5秒先超时；另一次/login导航超过既有60秒。A1日志确认复杂页首编69.7秒，期间/login耗65.5秒。补精确POST回执及原有导航预算，不改模型/业务。 | 0；未到模型阶段 |
| attempt-02 | 3 failed | 真实登录POST200后/home ERR_EMPTY_RESPONSE；后两项/login立即ERR_CONNECTION_REFUSED。A1确认cgroup oom_kill=1，Web退出后runner清理全栈，正改独立预构建/start入口；停止重复运行。 | 0；未到模型阶段 |
| attempt-03 | 3 failed | 生产栈登录/建组成功；QA helper误用跨origin browser fetch，已改复用实际产品same-origin API prefix，不改CORS或业务。 | 0；未到模型阶段 |
| attempt-04 | 1 interrupted、2 did not run | 真实S1已建run，dispatch前缺计费回调而失败；root确认终态后释放浏览器，未再等满240秒。A1修真实runner配置，旧失败保留。 | native尝试1；供应商0有A1实证 |
| attempt-05 | **2 passed、1 failed** | FR16found关联实际S2版本→none→精确历史通过；真实断网留稿/重试、CAS409→审阅后V3、匿名401、归档403/解归档通过。S1新run在8.7秒真实终态MODEL_CALL_FAILED，未生成有效回复，不重复发送。 | native新增1；供应商调用待A1核对，未知仍占预算 |
| attempt-06b | 1 failed | funded技术actor真实S1在等待confirm_task_intent时达到240秒，未自动批准/重发；该原生卡误认S1为empathize，保留差异。 | 1个真实native run已调用供应商，后续只恢复同run |
| attempt-07 | 1 failed | QA根testid错误（实际为-shell），卡未点击，没有新增模型运行。 | 0新增 |
| attempt-08 | **1 passed** | 恢复06b同run，学生通过原生改假设纠正阶段，精确Skill pin/持久问句/无新human消息/学生回应重写主题保存/freshlogin通过。 | 同run总计5 physical requests、33647模型tokens、5 settled（A1实证），不是1 completion |
| attempt-09/10 | 1 failed各一次 | QA先将sources误认成aidt-materials；修正后走完21处，在缺少S5已确认问题的Design入口被真实门拦住。保留失败，补真实学生前置，不改产品门。 | 0新增 |
| attempt-11 | **1 passed** | 22处全界面成员文字通过，真实S5显式保存后进入空Design；巡检阶段快照不变、未触发原生Chat/Design生成。 | 0新增 |
| attempt-12 | **1 passed、1 failed** | 新产物真实raw/discovery/三持久图片与逐份beforeprint通过；本地图场QA错误地期待dataURL保存时自动剥除，被真实契约在发PUT前拒绝，失败保留。 | 0新增 |
| attempt-13 | **1 passed** | 只复验修正QA顺序的本地图场：先保存文字/多标签/拟选，再临时图保存明确拒绝且无PUT；重新审阅后三份真实print图片已加载，服务器仍精确等于先前saved。 | 0新增 |

attempt05已脱敏的 [机器结论](./v2-attempt05-machine.json) 与原Playwright结果分开留存；两项通过不扩大为真实Agent、照片上传或完整V2通过。跨进程预算动态检查退出0：失败保留额度、不同进程不能重置七次上限、同Skill不自动重发、并发锁冲突不覆盖总账；该检查不调用模型。

S1同run恢复 [实际证据](./v2-s1-existing-run-machine.json) 仅证明原机械记录范围；旧TeachingContext drop缺陷保留。来源桥接已批准并通过[22项真实PG/实际适配器本机集成](./bridge-real-pg-machine.json)；[S2浏览器仅受理/prepared回执](./context-prepared-browser-final-machine.json)已真实通过，保留[修复前UI红](./context-prepared-browser-machine.json)。后续本次同组实证已实际开启S1与S2供应商执行，机械来源见下节；S2因错误基础Agent中断取消，S3–S6/SUM仍未运行，不用prepared或一次派发当完整教学通过。普通学生余额0，管理员+owner的无费用受理不证明学生付费权限。

22处成员文字 [实际证据](./global-member-text-surfaces.json) 与机器S1、A5静态原型、root812项Web回归分别记载，任何单项不合并冒称完整V2或人类已验收。

脱敏机器结果位于隔离运行证据目录；身份文件与原始配置不分享。新spec静态ESLint、3例发现、明确源文件TypeScript诊断0、testid gate6338通过。全库spec-gate仍有既存3项CI覆盖缺口。root明确采用真实专属config，并仅精确排除新文件进入普通fullstack；该lane默认CI未跑，不冒充已有CI覆盖。

## 本次同组真实模型补充与零费用交付

实际证据统一见[本次安全索引](./real-completion-20261116/README.md)。产品初版API/Web为c361ba55b；新清单PDF/S6原件UI为ec5ff2e9d Web，API仍c361ba55b，不混写构建SHA。

| 场景 | 实际结果 | 费用与边界 |
| --- | --- | --- |
| S1启动器attempt01 | 0测试退出1，grep锚定错误；旧失败保留 | 0browser/0reservation/0send |
| S1 attempt02 | 1 passed，17.7秒/总18.7秒；真实sourceV1→派发→学生正式主题V2→新登录 | 新独立1额度已用；1physical/10065tokens/10.07测试credit settled；单一追问行为false，base echo夹具冲突不隐藏 |
| S2 attempt01–04 | 4次零native发送QA前置失败，逐次freshA1证明无新run/旧账不变；上传201、MIME charset、恢复分支、真实披露展开均纠正 | 保留所有attempt与proofSHA，不清phase。TXT正常GET/byte/hash/headers→既有stagePUT恢复，PNG实际UI；不重复POST |
| S2 attempt05 | 唯一真实send，来源S1V2/S2V4与dispatch核过；错误core-loop echo任务卡未批准/修改，后正常cancelled | 1physical/8222tokens/8.23测试credit settled，旧额度占用，不能自动新发；无AI后学生采纳成功 |
| 免费S2人工清单 | 首轮通过4.2秒；人工fallback另存V5，原稿不混入真实beforeprint文档；实际PDF bytes/解析/嵌入字体/视觉可读/新登录通过 | 不是AI成功、不是OS另存窗口自动化，也不是三份点子PDF |
| 免费S6独立原件 | 首轮通过4.8秒；TXT+PNG实际上传/字节/SHA/decode/保存V1/新登录，同org正常consultant非成员404与owner错project404 | 无假原型/问题快照/学习确认；不冒完整同组原型/反馈链 |
| S3/S4/S5/S6/SUM与本次新增Design V1/V2 | 未运行，不写通过 | 后续配置修复与新增收费任务必须另核明确预算；不挪用旧7/已用S1补账/Design额度重试S2 |

零费两场共2 passed（10.1秒）；A1独立after证明global physical/usage/credit仍各2、active/holds/unsettled/unbounded0，两个收费账本hash前后不变。该after计数是本栈此前S1/S2实际用量，不能写成本栈从未调用模型。

本次QA单元31项通过（含独立S1账、跨进程拒重复、同组状态、只接受fresh唯一零sendproof与严格selector/receipt），owned TypeScript/ESLint与用例发现通过；这些不是收费场景通过。人工验收手册H01–H15结果与签字全部保持空白。

本轮后续配置修复：私有测试实例已追加canonical默认指令版本，原echo版本及旧run/消息/来源/权限/资金不变；A1独立15组数据与两账hash核对通过，模型新增0。普通发布API的legacy定义缺口没有绕成已验收；S2仍需修复后真实补测。见[修复证据](../../context-bridge-20261116/a5/fixture-canonical-repair.md)。
