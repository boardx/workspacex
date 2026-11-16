# AIDT V2 FR01–19 用例与证据矩阵

需求来源：[用户完整 V2 Markdown](../../../../requirements/aidt-v2-full.md)，root已原样落库并核对72091bytes；FR15–19 的新增摘录另见 [aidt-v2-delta](../../../../requirements/aidt-v2-delta.md)。本矩阵是验收索引，不是新增需求或设计签核。

状态只认实际运行：`已通过`必须有当前源码对应的浏览器/服务证据；`已编写`仅表示可发现的测试文件；`待接口`不作为通过；`后置`保留用户明确优先级或决定。

| FR | 用户可见行为与关键断言 | 验收场景/事实来源 | 当前状态与缺口 |
| --- | --- | --- | --- |
| 01 | 课程/小组/成员关系，所属组入口，双组隔离，新登录重入 | V2-C1；A2真实课程UI；`fr01-course-entry/course-api-after-filter.json`与`course-final-index.json` | API-only 17项通过；final01三场UI因rewrite缺失失败并保留；修复后最终4bfb产物final02三场真实UI全部通过（15.4秒、0重试/模型），含真实普通成员边界、双组隔离、新登录、归档/分页/离线重试。P3创建项目回执缺provenanceEventId保留；人工H01未签字。 |
| 02 | 六阶段当前成果、保存状态、返回保留旧成果 | N08双cycle、旧V1/3/4/5/6对比headV8 | 原有范围已真实通过；V2新字段需按小场景再验。 |
| 03 | 一个引导师按阶段Skill及已保存组上下文追问，学生先输入/决定 | V2-R1与S2–S6参数场景：真实UI发送→native run→durable assistant→学生确认 | S1机械同run恢复通过；已确认旧桥接丢弃TeachingContext。修复三件束待人类签核、新来源回执未实现；后5步已编写但收费暂停，不能把wire匹配当模型消费证明。 |
| 04 | 想法、讨论结论、选择理由可编辑、共享保存、重进 | V2-R1/共享CAS；N08已保存S1/S4/S6精确重读 | CAS/断网留稿及明确重试真实通过；S1同run恢复后学生编辑确认与新登录精确恢复通过。该机械保存结果不证明Agent读取了组上下文。 |
| 05 | 文字/图片材料上传与来源阶段关联；录音/语音另排 | V2-E1：真实上传回执、原字节/引用回读、发现卡；`v2-raw-materials-and-print-machine.json` | 新生产产物真实文字/PNG上传、SHA/原字节/来源头、共享保存重载、非组员404、离线读取重试且无再上传通过，模型请求0。录音/转写按用户决定后置。 |
| 06 | 原始证据/学生解释/AI推测分开，洞察关联或待验证 | V2-E1/FR16发现卡与历史来源 | 图片/原件引用、原话逐字、学生解释与独立AI推测字段的真实保存回读通过；文本/卡片关联历史此前通过。推测字段是明确合成夹具，不声称本场调用了模型或做过真实访谈。 |
| 07 | 选择/投票边界；至少三不同点子，名称/图/2–3句描述单/PDF | V2-I1；N08多标签与选择分离；M13/M14 | 三不同点子持久图片与临时图两条路径、逐份真实beforeprint/独立ideaID/图片已加载均通过；本地bytes共享保存明确拒绝且server不变。原生选择不是投票；实际另存PDF字节仍由人工H06核对。 |
| 08 | 原型类型、界面文字/可选参考图及历史上下文→静态方案→选择修改与版本 | V2-P1，A5 native Design实际POST与GET version | A5 funded技术actor实际2次POST、V1/V2 source=model与immutable seq/可见内容通过；不证明学生资金权限或真实研究。最新scope修复仍需最终产物复验。 |
| 09 | 测试问题/反馈材料、对应原型与认识变化、按需新版 | V2-P1/FR19；N08原问题snapshot固定 | A5真实S5新问题与S6旧问题/版本冻结隔离、版本变更关系保存重载通过；真实用户测试不存在，图片反馈待最终原件链验收。 |
| 10 | 一组报告汇集问题演变、证据、创意、原型/测试、已有教师点评与建议；可编辑导出/缺口不编 | V2-S1真实summary线程与审阅导入；N08历史追加/保存/重登录 | N08历史报告范围已真绿；SUM入口/独立线程/审阅导入已实现，收费真实运行因服务端上下文来源契约待签核暂停，不能称完整Agent报告/导出通过。 |
| 11 | 线上线下同组共享成果，多端隔离与冲突 | V2-B1、全界面22场景；N08双账号跨重启 | V2 CAS/网络恢复/只读与22处全局文字插件真实通过（setup admin）；N08成员互发/幂等/重启通过。学生角色课程隔离由A2独立用例另验；实时合并/会议规则待定。 |
| 12 | 教师授权进度与点评，不评分 | 教师授权/已有点评入口 | P1后置；不编造教师点评或用管理员替代教师验收。 |
| 13 | 学生自主叙事展示 | 学生编辑报告与现有导出 | P1；自动PPT待定，不把HTML/Markdown称PPT。 |
| 14 | 打印/3D | 现有打印/导出边界 | P2后置；PDF导出不等于3D。 |
| 15 | 理由/观察或抱怨或猜测来源，AI追问后学生确认，仍待研究 | V2-R1，S1未确认V1→同run确认卡学生纠错→真实追问→学生回应确认V2→新登录 | funded技术actor同run恢复真实通过；模型阶段误识与context桥接问题保留，不冒称学生权限/资金已满足。 |
| 16 | 画像前意外发现或显式暂无，关联材料和具体来源版本，保留矛盾/例外 | V2-E1：S2材料V1→S3foundV1→noneV2→历史精确回读 | 文本/卡片关联小场景真实通过；照片上传在最终产物另验。 |
| 17 | easy/breakthrough/fun可多标签、确认与选择分开、不凑三类配额 | V2-I1；N08学生修分类会取消确认，选择保留 | 多标签easy+fun与拟选另一候选真实保存通过；三份独立真实print通过，实际PDF另存文件仍待人工验收。未要求三类各一项。 |
| 18 | 先写/确认本轮问题，生成绑定真实版本，修改取消确认，保存先前认识 | V2-P1；N08未确认不开放生成、确认快照与S6带入 | 原有问题门槛与A5真实静态两版本/问题快照通过；新scope修复需最终产物验证，不将技术账号替代学生权限。 |
| 19 | 测试后认识变化/不变/证据不足，返回1–5或未决定，理由行动与旧版保留 | N08真实历史/原生Chat/重启；V2-P1按需新原型 | 旧返回与报告已通过；A5新iteration原型/旧snapshot与修改依据关系保存重载通过，真实反馈材料链待最终产物验收。不强制回1–4先生成新版，不声称模拟反馈是真人测试。 |

## 本轮小场景入口

- `apps/web/playwright.aidt-v2.config.ts`：只连接A1已有预约栈，不启动服务；零重试、串行、关闭可能记录凭据的原始trace。
- `apps/web/e2e/aidt-v2-student-journey.spec.ts`：学生先输入→真实原生Agent→学生确认→实际保存；FR16found/none；真实CAS、匿名与归档只读。
- `apps/web/e2e/support/aidt-v2-acceptance.ts`：实际浏览器会话鉴权、契约解析、真实Skill挂载、durable run/message关联；真实失败终态及时退出。
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

S1同run恢复 [实际证据](./v2-s1-existing-run-machine.json) 仅证明机械记录范围；真实TeachingContext drop缺陷已确认，来源三件束待人签核且新receipt未实现。后5步/SUM暂停收费，不以wire证明模型收到材料。无收费新设计见 [服务端验收草稿](./server-context-acceptance-draft.md)。普通学生余额0，funded管理员仅模型技术actor；attempt05 setup账号也为admin，不单独证明consultant学生权限。

22处成员文字 [实际证据](./global-member-text-surfaces.json) 与机器S1、A5静态原型、root812项Web回归分别记载，任何单项不合并冒称完整V2或人类已验收。

脱敏机器结果位于隔离运行证据目录；身份文件与原始配置不分享。新spec静态ESLint、3例发现、明确源文件TypeScript诊断0、testid gate6338通过。全库spec-gate仍有既存3项CI覆盖缺口。root明确采用真实专属config，并仅精确排除新文件进入普通fullstack；该lane默认CI未跑，不冒充已有CI覆盖。
