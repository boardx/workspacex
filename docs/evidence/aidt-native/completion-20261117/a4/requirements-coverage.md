# AIDT FR01–19 覆盖矩阵（最终报告合并用）

证据截止 **2026-11-16 17:40 UTC**；目录沿用本轮`completion-20261117`标签。需求依据为[完整V2正文](../../../../requirements/aidt-v2-full.md)中FR01–19（733–751行）与[新增摘录](../../../../requirements/aidt-v2-delta.md)。本页仅核现有源码/本地证据，**没有新运行浏览器、模型或大套件；不是19项全通过**。

本轮实际Web源`ff9b73ebefa9b05047e918c2018b6d360f90feb3`、BUILD `HpTdw6E9Fzu6NgYyCuctM`；包含`c9cf6ebb7`重试草稿修复。源码检查HEAD及各来源hash见[机器矩阵](requirements-coverage.json)，源码存在不等于对应当前构建已执行。

证据分层：**本轮B/M**=当前构建真实浏览器/真实模型（两者也须区分）；**历史N/M**=当时源码的真实服务/持久化/浏览器或模型；**C/源码**=受控mock/jsdom/端口、真实PG专项或仅代码；**未验/后置**保持独立，不能用上层数量代替。受控测试有重叠，不把812/1103/50/25/11等相加。

截至本页：新轮S1机械链通过35.1秒；S2先因`write_todos`护栏中断，root审阅后同local run单次正常UI确认，续跑通过17.4秒，无新student send/reserve；学生保存分别V1→V2、V3→V4并新登录回读。**S3正在执行，S4–S6/SUM及本轮新Design未有完成证据。** A3对S1保留4问号/引号改写等小偏离，不能称教学全绿。阶段变化以新增实际证据更新，不用未结束进程推测。

| FR / 范围 | 本轮实际浏览器/模型 | 历史真实证据（不当本轮复验） | 受控/源码与确有缺口 | 来源 |
| --- | --- | --- | --- | --- |
| FR01 课程、小组与成员入口（P0） | B2：正常admin UI建专用组、owner正常API加已有consultant；双登录重读成员/未入组拒绝。B1首场consultant无创建入口属正确边界，未伪提权。 | H1：课程登记/关联、同课双组隔离、fresh login、归档与分页/错误重试三场通过（4bfb构建）。 | 课程客户端/角色与生命周期受控；配置动作不等于专门教师身份。 **缺口：**新Web未重跑完整课程三场；独立班级名册、教师跨组授权与30人课堂未验。 | [B2](member-attempt02-browser-machine.json)、[B2SETUP](member-pair-review.md)、[H1](../../fr01-course-entry/course-final-index.json) |
| FR02 六阶段、当前成果与返回（P0） | B1：失败不推进/不改S1保存稿。M1/M2：实际S1 V1→V2、S2 V3→V4，学生显式保存与新登录一致。 | H6/H7：六步导航、旧版本返回、双cycle持久化。 | QSHARED/QCONTEXT：未保存稿与保存版本分开、迟到/ABA不覆盖。 **缺口：**新轮尚未完成S3–S6/SUM；保存次数不是教学完成率，没有自动锁步或全员共识统计。 | [B1](attempt02-browser-machine.json)、[M1](../../completion-20261116/a6/fresh-journey-20261117/s1-machine.json)、[M2](../../completion-20261116/a6/fresh-journey-20261117/s2-machine.json)、[H6](../../module-isolation/v2/native-acceptance.md)、[H7](../../completion-20261116/acceptance-baseline-N08.md)、[QSHARED](../../../../../apps/web/tests/ui/aidt-shared-stages.test.tsx)、[QCONTEXT](../../../../../apps/web/tests/ui/aidt-native-context-parent.test.tsx) |
| FR03 单一引导师、阶段与已保存上下文（P0） | M1/M2：真实原生Chat、精确selector/单Skill、派发或同run checkpoint续跑；学生原话和来源分开。S3执行中，未记通过。 | 旧echo误认、drop、MODEL_CALL_FAILED均保留；历史prepared/PG不得替代模型成功。 | QCONTEXT及桥接受控/PG核精确旧源、权限和普通Chat无额外语义；B1只是真实浏览器传输失败注入。 **缺口：**S1有4问号选项及引号改写偏差；理由缺失追问分支未测，S2内容审阅待补；S3–S6/SUM/新Design未形成当前完整闭环，普通学生模型资金/教学效果未证明。 | [M1](../../completion-20261116/a6/fresh-journey-20261117/s1-machine.json)、[M2](../../completion-20261116/a6/fresh-journey-20261117/s2-machine.json)、[CONTENT](../../completion-20261116/a3/fresh-round-content-review.md)、[ROUND](../a1/round-status.json)、[QCONTEXT](../../../../../apps/web/tests/ui/aidt-native-context-parent.test.tsx)、[B1](attempt02-browser-machine.json)、[OLDFAIL](../../completion-20261116/a1/s2-supplement-20261116/post-failure-diagnostic-financial-verification.json) |
| FR04 想法、讨论、结论与选择理由（P0） | M1/M2：真实学生修订/采纳、显式共享保存、fresh login；B2人类消息独立于阶段成果。 | H2/H6/H7：历史成果编辑/重入、冲突保稿与旧历史。 | QSHARED：只接受真实保存回执，新编辑不冒已保存。 **缺口：**真实多人讨论共识/课堂意义未验；聊天发送、AI回复均不自动成为组结论。 | [M1](../../completion-20261116/a6/fresh-journey-20261117/s1-machine.json)、[M2](../../completion-20261116/a6/fresh-journey-20261117/s2-machine.json)、[B2](member-attempt02-browser-machine.json)、[H2](../../completion-20261116/a6/v2-attempt05-machine.json)、[H6](../../module-isolation/v2/native-acceptance.md)、[QSHARED](../../../../../apps/web/tests/ui/aidt-shared-stages.test.tsx) |
| FR05 原始文字/图片/附件及录音关联（P0） | M2引用本组保存S2版本；本轮不由此宣称原件字节已进模型。B1只验证Chat pending附件故障重试及正常取消。 | H3：S2真实TXT/PNG原字节/hash/版本/提交者与隔离；H4：S6独立TXT+合成PNG→显式save/newlogin。 | QRAW：授权/ID/hash/MIME校验、processing失败≠原件不可读、外部value迟到守门。 **缺口：**访谈录音/ASR及语音用户后置；无真人采集/同意流程实测。上传不等于阶段已存/索引READY/研究有效；新轮S6材料链未跑。 | [M2](../../completion-20261116/a6/fresh-journey-20261117/s2-machine.json)、[B1](attempt02-browser-machine.json)、[H3](../../completion-20261116/a6/v2-raw-materials-and-print-machine.json)、[H4](../../completion-20261116/a6/real-completion-20261116/free-deliverables-machine.json)、[QRAW](../../../../../apps/web/tests/ui/aidt-research-material.test.tsx) |
| FR06 原证据、学生解释与AI推测分开（P0） | M1实际把猜测与未知保留；M2精确采用学生保存版本，模型未自动读原文件字节。 | H3/H2：发现卡引文/来源/学生解释/模拟AI推测独立，found/none历史可追溯。 | 发现/材料控件和report格式受控；读取失败不显示未核实服务metadata。 **缺口：**全部研究材料为明确合成夹具；系统不证明真实访谈发生或洞察有效，真人证据/教学判断未验。 | [M1](../../completion-20261116/a6/fresh-journey-20261117/s1-machine.json)、[M2](../../completion-20261116/a6/fresh-journey-20261117/s2-machine.json)、[H3](../../completion-20261116/a6/v2-raw-materials-and-print-machine.json)、[H2](../../completion-20261116/a6/v2-attempt05-machine.json)、[QRAW](../../../../../apps/web/tests/ui/aidt-research-material.test.tsx)、[CONTENT](../../completion-20261116/a3/fresh-round-content-review.md) |
| FR07 候选选择、三份不同图文描述单/PDF（P0） | 新轮S4尚未到达，不能记本轮描述单通过。 | H3/H3LOCAL：三不同id/名称/图/2–3句、逐份beforeprint图片已解码；临时图共享保存明确拒绝，文字稿仍在。 | C1/QPRINT：全部图与clone有界decode、失败不print、scope变更取消；重复/空idea id阻打印。 **缺口：**已有拟选择/理由；多人投票及票规未实现。三份描述单实际PDF文件/用户另存与物理打印未有本轮新实证；打印事件不是文件保存。 | [H3](../../completion-20261116/a6/v2-raw-materials-and-print-machine.json)、[H3LOCAL](../../completion-20261116/a6/v2-local-preview-and-print-machine.json)、[C1](../../completion-20261116/integration/v2-print-50.txt)、[QPRINT](../../../../../apps/web/tests/ui/research-print-images.test.tsx) |
| FR08 静态原型生成、选择、修改与版本（P0） | 新轮S5及新Design尚未执行，不能借旧生成记本轮通过。 | H5：真实模型静态V1/V2、不同不可变版本、可见标记、学生picker保存及旧/新版关系。 | QITER/QCONTEXT：原型owner/关联交集、迟到选择/ABA、旧问题绑定。 **缺口：**历史构建需与当前来源锁/新增context接线区分；普通学生模型权限、广泛原型质量/类型和真人测试未验。 | [H5](../../completion-20261116/a5/real-design-funded-result.json)、[QITER](../../../../../apps/web/tests/ui/aidt-iteration-prototype.test.tsx)、[QCONTEXT](../../../../../apps/web/tests/ui/aidt-native-context-parent.test.tsx) |
| FR09 测试材料、被测版本、反馈与按需新版（P0） | 新轮S6尚未执行。 | H4：S6独立原件保存/隔离（无假原型）；H5/H6：旧问题/版本冻结、反馈/修改理由关系与返回。 | C3/QITER：精确历史return校验、无新版回1–4合法、修改撤确认/旧历史保留。 **缺口：**独立原件用例不等于反馈→原型→认识变化完整链；未做真人用户测试/录音，新轮新版端到端待验。 | [H4](../../completion-20261116/a6/real-completion-20261116/free-deliverables-machine.json)、[H5](../../completion-20261116/a5/real-design-funded-result.json)、[H6](../../module-isolation/v2/native-acceptance.md)、[C3](../../completion-20261116/a2/return-pg-20261116/machine.json)、[QITER](../../../../../apps/web/tests/ui/aidt-iteration-prototype.test.tsx) |
| FR10 一组一份可审阅报告、来源与导出（P0） | 当前新轮SUM尚未执行。M2的146318B采纳提纲PDF是S2成果，不代替小组研究报告。 | H6/H7：报告全文/来源历史、主动审阅追加、保存与跨重启新登录；历史原生spec有Markdown下载行为。 | QREPORT/QPDF/QSUM/C1：人工段保护、缺失项/点评不造、Markdown下载、async print失败留稿/重试。 **缺口：**本轮六步→真实SUM→学生审阅/保存→报告文件导出未验；教师点评真实授权来源缺失；打印预览不等于已有PDF文件，手册PDF也不算学生报告。 | [H6](../../module-isolation/v2/native-acceptance.md)、[H7](../../completion-20261116/acceptance-baseline-N08.md)、[M2](../../completion-20261116/a6/fresh-journey-20261117/s2-machine.json)、[QREPORT](../../../../../apps/web/tests/ui/aidt-summary-report.test.tsx)、[QPDF](../../../../../apps/web/features/aidt/components/aidt-report-preview.tsx)、[QSUM](../../../../../apps/web/features/aidt/lib/aidt-summary-context.ts)、[C1](../../completion-20261116/integration/v2-print-50.txt) |
| FR11 线上线下同组共享与人类沟通（P0） | B1：插件关闭/切步恢复两份未发稿，2条真实存储；B2：独立双登录4条频道/互回、双reader唯一、另一组3路404；A1独立该tenant模型0。 | H7/H6：成员消息跨重启、375px续发；历史22处全局入口和CAS/归档。 | 成员权限/旧响应乱序/发送失败、单层话题pending禁旧composer有受控覆盖。 **缺口：**未发成员稿仅同页面会话内存，reload/logout不恢复；30人并发、真实长期离线/撤权竞态、在线/未读/已读、会议/语音/共同光标未验或未做。 | [B1](attempt02-browser-machine.json)、[B2](member-attempt02-browser-machine.json)、[B2SETUP](member-pair-review.md)、[H7](../../completion-20261116/acceptance-baseline-N08.md)、[H6](../../module-isolation/v2/native-acceptance.md)、[C2](../../zero-cost-followup-20261116/a4/failure-draft-review.md) |
| FR12 教师授权进度与点评（P1） | 本轮仅技术admin/owner配置，不是教师角色验收。 | 历史课程与项目权限不能替代教师点评流程。 | QSUM明确teacherComments=null及缺来源，不补造。 **缺口：**P1专门教师进度/点评界面和真实授权点评来源未完成；评分已明确后置。 | [QSUM](../../../../../apps/web/features/aidt/lib/aidt-summary-context.ts)、[H1](../../fr01-course-entry/course-final-index.json) |
| FR13 学生自主叙事展示（P1） | 未执行专门展示场景。 | 可人工编辑/导出报告，但不等于专门叙事展示流程。 | 无本次专用已通过实证。 **缺口：**P1专门流程未交付；自动PPT范围待定，不能用通用Office/Markdown代替。 | [REQ](../../../../requirements/aidt-v2-full.md)、[QPDF](../../../../../apps/web/features/aidt/components/aidt-report-preview.tsx) |
| FR14 打印及3D文件（P2） | M2实际采纳清单PDF可读；不是物理打印或3D。 | H3是beforeprint；H4有清单PDF字节。 | QPRINT/C1有界加载/失败/取消，非设备验收。 **缺口：**P2/首版非承诺：3D文件/设备未接，物理打印与操作系统另存对话未验。 | [M2](../../completion-20261116/a6/fresh-journey-20261117/s2-machine.json)、[M2PDF](../../completion-20261116/a6/fresh-journey-20261117/student-reviewed-interview-guide.pdf)、[H3](../../completion-20261116/a6/v2-raw-materials-and-print-machine.json)、[H4](../../completion-20261116/a6/real-completion-20261116/free-deliverables-machine.json)、[QPRINT](../../../../../apps/web/tests/ui/research-print-images.test.tsx) |
| FR15 选题理由、观察/抱怨/猜测反思（P0） | M1：理由/猜测来源/未知保留，真实回复→学生自答/方向选择/主题V2/新登录。 | H6：确认记录持久化，修改撤确认。 | 问题反思组件与格式受控。 **缺口：**CONTENT：本场已有why，缺理由时价值追问分支未验；4问号与偏缺陷前提引号改写待真人审阅，不称严格一问全过。 | [M1](../../completion-20261116/a6/fresh-journey-20261117/s1-machine.json)、[CONTENT](../../completion-20261116/a3/fresh-round-content-review.md)、[H6](../../module-isolation/v2/native-acceptance.md) |
| FR16 画像前意外发现/暂无与材料关联（P0） | 新轮S3进行中，未标通过。 | H2：有材料关联found→none合法并保存/历史回读；H6有none重启恢复。 | surprise/reflection与source revision锁定受控，移除/失效关联不冒确认。 **缺口：**本轮模型如何处理矛盾/例外/暂无未完成验收；真人研究仍未发生。 | [H2](../../completion-20261116/a6/v2-attempt05-machine.json)、[H6](../../module-isolation/v2/native-acceptance.md)、[ROUND](../a1/round-status.json) |
| FR17 easy/breakthrough/fun多标签与学生确认（P0） | 新轮S4未执行。 | H6/H3LOCAL：easy+fun多标签、类别为空合法、拟选另一候选、理由修改撤确认；分类/选择分离。 | idea-classification/readiness组件受控，不以跨类同点子凑三份。 **缺口：**多人投票不是现有标签/拟选；当前新轮分类→三份PDF未验，课堂共识未验。 | [H6](../../module-isolation/v2/native-acceptance.md)、[H3LOCAL](../../completion-20261116/a6/v2-local-preview-and-print-machine.json)、[C1](../../completion-20261116/integration/v2-print-50.txt) |
| FR18 先确认验证问题并绑定原型版本（P0） | 新轮S5未执行。 | H6：未确认禁生成/修改撤确认；H5：实际版本与S6旧问题绑定、不同新版本保持旧快照。 | QITER/QCONTEXT：saved来源不跟未保存draft/head漂移、精确旧修订/迟到取消。 **缺口：**历史N/M不等于本轮新context+新Design完整验证；静态意向不证明真实时间、付费或效果。 | [H6](../../module-isolation/v2/native-acceptance.md)、[H5](../../completion-20261116/a5/real-design-funded-result.json)、[QITER](../../../../../apps/web/tests/ui/aidt-iteration-prototype.test.tsx)、[QCONTEXT](../../../../../apps/web/tests/ui/aidt-native-context-parent.test.tsx) |
| FR19 认识变化/不足与返回1–5/未决定（P0） | 新轮S6未执行。 | H6/H7：changed/unchanged/insufficient、return1/2与undecided、精确旧反思与新登录；H5有返回原型及新版关系。 | C3：真实PG return-only及拒绝场景，无供应商/浏览器；回1–4不强制新版。 **缺口：**本轮S6引导师/返回后再一轮/SUM待验；无真人反馈依据，不用保存次数或新版本数充完成学习轮数。 | [H6](../../module-isolation/v2/native-acceptance.md)、[H7](../../completion-20261116/acceptance-baseline-N08.md)、[H5](../../completion-20261116/a5/real-design-funded-result.json)、[C3](../../completion-20261116/a2/return-pg-20261116/machine.json) |

## 错误与运行边界专项

| 分支 | 实际覆盖层与证据 | 尚未覆盖 / 不能推断 |
| --- | --- | --- |
| 原生发送失败/草稿保留 | B1真实浏览器在server受理前`route.abort`：A重试不丢B正文/新附件/@mention，A原文/client/selector/旧附件不变，B新发送正常清稿；线程GET messages空、无canonical receipt，A1独立run/physical0。C2实际错误总线覆盖MODEL_CALL_FAILED及banner/trace两入口。 | 浏览器注入不是服务端模型真实失败；无canonical run时未伪造timeline事件，trace仍controlled。真实收费重试及重试后撤权未在本轮浏览器重跑。 |
| 成员发送/组隔离 | B2双方真实200/201/stored/作者会话对应；private组频道/话题读取及POST均404。旧controller受控覆盖失败重试/重复/乱序和只读。 | 本轮不是网络断线/长期离线/并发撤权或30人课堂。未发送成员稿仅页面会话内存；跨reload/logout不是现有承诺。 |
| 409冲突 | H2真实CAS冲突保文本→人工比较/显式重试；H1一组第二课409；QSHARED控制未知保存结果复用operationId、旧回执/ABA不覆盖。 | 新ff9构建未重跑归档/409全部浏览器场景；B2当前幂等唯一回读不是409冲突测试。 |
| 归档只读/匿名/权限 | H2匿名401、归档写403；H1归档已有课程组可读/新关联拒绝；旧成员E2E有archive canWrite=false。只读组件可读/打印但不改写。 | 本轮B1/B2不是当前构建的归档专项。不能把read-only当作不能看资料，也不能用org admin读权限冒充教师或普通学生权限。 |
| 原件/metadata/失败 | H3/H4真实原字节/hash/MIME/版本/提交者回读与错误project/nonmember拒绝；QRAW校验失败不显假提交者，`INGESTION_FAILED`只允许授权原件内容核验，不宣称READY。 | 合法原件已上传、阶段引用保存、索引READY、研究有效是不同事实；无真人研究/录音授权实测。 |
| 打印/报告导出 | M2真实S2采纳清单PDF146318B、可解析，来自实际beforeprint DOM的Chromium文件；H4保留人工fallbackPDF。C1/QPRINT覆盖clone延迟/失败/10s有界decode、最终scope取消、无图报告回归；QPDF失败保留编辑并可下载Markdown。 | 不是操作系统另存窗口自动化。三点子beforeprint不是三份已另存PDF；S2清单/人工手册PDF都不是SUM小组报告；物理/3D未验。 |
| 本地启动/健康/停止 | LOCAL提供doctor/build/start/status/health/stop；H6历史Linux原生PGlite/生产Web双停启、真实HTTP健康/重登录/端口释放，HEALTH明确模型能力可needs-install。READY是本轮标准工程栈实际健康/新构建，非用户本机CLI重跑。 | 本轮未重新运行本机CLI；Windows/macOS/用户电脑安装未验。health=API healthz+Web login响应及owner running，不等于模型/全部业务/公网可用；默认localhost只对启动电脑有效。 |
| 已知合同与财务边界 | 现有P3项目创建尚缺完整provenanceEventId，合法实现投影不得补造审计。新S1/S2用量与结算由ROUND独立审计；旧失败/未知用量/pending由OLDFAIL保全。 | 新轮结清不能覆盖旧S2的2pending/86.29测试credit未知费用；不能把一次逻辑send当一次物理completion，或HEAD/TLS连通当模型成功。 |

## 合并报告时须保留的缺口

1. 新轮完整六步→同组旧反思→SUM→报告审阅/导出尚未闭合；S3进行中不计通过，后续须以A6实际结果补齐。
2. 真实S1来源与学生主导边界有实证，但严格单一追问/缺理由价值追问、S2及后续教学内容仍需独立/真人审阅。技术funded admin不证明普通学生模型权限。
3. 录音转写、访谈同意流程、语音房后置；本轮合成照片/原话不是真人访谈、测试或课堂学习证据。
4. 当前新build未重跑历史归档、409、完整课程分页/生命周期及本机双cycle；保留历史源码和真实证据，不涂成当前全量回归。
5. 真实三份点子PDF文件另存、物理打印及用户设备验收未闭合；新S2清单文件不能替代。
6. FR12专门教师进度/点评授权来源、FR13叙事展示未完成；评分/语音已后置，FR14的3D/设备仍P2。
7. 成员文字最新真实双账号通过不等于30人并发、在线/未读/已读或所有撤权竞态已验；实时编辑光标/会议未交付。
8. 人工H01–H15结果和签字仍由人填写；Library手册PDF与本矩阵不替代教学/设计签核，无生产部署结论。

## 来源索引与快照说明

下列链接为实际本地文件；JSON保存本页检查时hash，后续来源文档若补充S3等会有正常变化。历史矩阵中的“context尚未修复/模型配置缺失/S2未成功”等时间状态，不套用为当前新S1/S2状态；其原失败保留。新轮计量也不抹旧pending。

- **REQ** FR01–19需求正文：[aidt-v2-full.md](../../../../requirements/aidt-v2-full.md)。
- **DELTA** FR15–19原文摘录：[aidt-v2-delta.md](../../../../requirements/aidt-v2-delta.md)。
- **B1** 本轮免费原生草稿/成员单账号浏览器：[attempt02-browser-machine.json](attempt02-browser-machine.json)。
- **B2** 本轮双账号/私有组隔离浏览器：[member-attempt02-browser-machine.json](member-attempt02-browser-machine.json)。
- **B2SETUP** 真实成员配置、首红与同源复验：[member-pair-review.md](member-pair-review.md)。
- **M1** 新轮S1浏览器+真实模型+保存/新登录：[s1-machine.json](../../completion-20261116/a6/fresh-journey-20261117/s1-machine.json)。
- **M2** 新轮S2同run续跑+保存/新登录+PDF：[s2-machine.json](../../completion-20261116/a6/fresh-journey-20261117/s2-machine.json)。
- **M2PDF** 学生采纳提纲实际PDF文件：[student-reviewed-interview-guide.pdf](../../completion-20261116/a6/fresh-journey-20261117/student-reviewed-interview-guide.pdf)。
- **CONTENT** 本轮教学内容独立审阅：[fresh-round-content-review.md](../../completion-20261116/a3/fresh-round-content-review.md)。
- **ROUND** A1新轮实际阶段/计量快照：[round-status.json](../a1/round-status.json)。
- **H1** 历史课程三场真实UI与归档/分页/离线索引：[course-final-index.json](../../fr01-course-entry/course-final-index.json)。
- **H2** 历史V2 found/none与CAS/归档/匿名；整体1红2绿：[v2-attempt05-machine.json](../../completion-20261116/a6/v2-attempt05-machine.json)。
- **H3** 历史真实原件/三图beforeprint：[v2-raw-materials-and-print-machine.json](../../completion-20261116/a6/v2-raw-materials-and-print-machine.json)。
- **H3LOCAL** 历史本地图保存拒绝与三份打印：[v2-local-preview-and-print-machine.json](../../completion-20261116/a6/v2-local-preview-and-print-machine.json)。
- **H4** 历史S2人工PDF/S6独立TXT+PNG真实两场：[free-deliverables-machine.json](../../completion-20261116/a6/real-completion-20261116/free-deliverables-machine.json)。
- **H5** 历史真实Design V1/V2/关系保存：[real-design-funded-result.json](../../completion-20261116/a5/real-design-funded-result.json)。
- **H6** 历史本机原生双cycle/V2/报告/停止清理：[native-acceptance.md](../../module-isolation/v2/native-acceptance.md)。
- **H7** N08历史范围与来源版本索引：[acceptance-baseline-N08.md](../../completion-20261116/acceptance-baseline-N08.md)。
- **C1** 打印受控50项日志：[v2-print-50.txt](../../completion-20261116/integration/v2-print-50.txt)。
- **C2** 重试草稿/附件/mention红绿；25与11有重叠：[failure-draft-review.md](../../zero-cost-followup-20261116/a4/failure-draft-review.md)。
- **C3** 历史return-only真实PG7项，无模型/浏览器：[machine.json](../../completion-20261116/a2/return-pg-20261116/machine.json)。
- **LOCAL** 本机启动/health/stop用户说明：[AIDT-LOCAL.md](../../../../development/AIDT-LOCAL.md)。
- **HEALTH** 历史本机真实health能力/警告：[health-cycle-2.json](../../module-isolation/local-prebuilt/final/health-cycle-2.json)。
- **READY** 本轮真实标准栈健康/构建基线：[zero-window-ready.json](../a1/zero-window-ready.json)。
- **OLDFAIL** 旧S2失败、未知用量与pending财务保全：[post-failure-diagnostic-financial-verification.json](../../completion-20261116/a1/s2-supplement-20261116/post-failure-diagnostic-financial-verification.json)。
- **QSHARED** 共享保存/离线/409/ABA/readonly受控用例：[aidt-shared-stages.test.tsx](../../../../../apps/web/tests/ui/aidt-shared-stages.test.tsx)。
- **QRAW** 原件核验/失败/来源metadata受控用例：[aidt-research-material.test.tsx](../../../../../apps/web/tests/ui/aidt-research-material.test.tsx)。
- **QPRINT** 实际打印clone图片加载/失败/超时受控用例：[research-print-images.test.tsx](../../../../../apps/web/tests/ui/research-print-images.test.tsx)。
- **QREPORT** 报告历史审阅与导入受控用例：[aidt-summary-report.test.tsx](../../../../../apps/web/tests/ui/aidt-summary-report.test.tsx)。
- **QCONTEXT** 保存source selector真实父组件受控用例：[aidt-native-context-parent.test.tsx](../../../../../apps/web/tests/ui/aidt-native-context-parent.test.tsx)。
- **QITER** 原型新版关系/迟到结果受控用例：[aidt-iteration-prototype.test.tsx](../../../../../apps/web/tests/ui/aidt-iteration-prototype.test.tsx)。
- **QLOCAL** 本机CLI生命周期/预构建失败受控用例：[aidt-cli-lifecycle.test.ts](../../../../../packages/local-runtime/test/aidt-cli-lifecycle.test.ts)。
- **QPDF** 报告Markdown下载/打印源码：[aidt-report-preview.tsx](../../../../../apps/web/features/aidt/components/aidt-report-preview.tsx)。
- **QSUM** SUM来源/缺失点评与不自动保存源码：[aidt-summary-context.ts](../../../../../apps/web/features/aidt/lib/aidt-summary-context.ts)。
