# 本轮十项工程反馈闭环

日期：2026-11-16。集成基线：`0e91f1714417c0bed7b1fa2359ee358446edfbdb`。本记录对应本轮实际发现的问题、代码修复及测试证据，**不是十次课堂迭代，也不是十轮真实 Agent 对话**。没有把讨论、计划、审阅建议或重复跑同一测试计为一次教学效果验证。

以下 SHA 使用当前集成历史；worker 原始 SHA 与 cherry-pick 后 SHA 不同时，以当前历史中的集成 SHA 为索引。U=单元/受控 API，C=组件/jsdom，S=类型/lint/静态验证。只有明确存在红日志的项目才称“先失败后通过”；新增功能缺口与源码审阅项不补造修前失败记录。不同条目的测试集有重叠，计数不可相加。

## 1. 已保存的返工学习记录没有进入原生 Chat

- **问题/复现**：第6步保存并选择返回第1–5步，链接保留 `returnRevision`，但 `sharedContextRefs` 只选当前及更早步骤，原生教学上下文收不到指定第6步反思。旧 host 的十个新增断言失败，原有23项通过。
- **修复**：`da056507c` 新增只读历史 loader；单次 `beforeRevision=revision+1, limit=1`，核对项目、第6步、确切修订、学生确认及目标步骤。host 接入既有 TeachingContext，提供同内容预览及失败重试；父宿主传参在 `0e91f1714` 集成。不另造 Chat UI，不以最新 head 代替指定历史。
- **验证**：[red-host.log](a2/red-host.log)、[red-loader.log](a2/red-loader.log)、[green-targeted.log](a2/green-targeted.log)：受影响及边界回归6文件69项通过。loader 初始红日志是模块缺失导致收集失败，host 日志才是行为反例。身份/取消/ABA/重试与未发送输入保留属于U/C验证，不能称模型已理解返工材料。

## 2. 返工 DTO 遗失原问题的历史第5步来源版本

- **问题/复现**：返工到第5步时，当前共享材料可以是V99，历史问题却来自V2；原 DTO 只有问题与原型文字，缺少历史问题的 `sourceStageRevision`，无法清楚区别两份来源。精确新增断言因缺字段而失败。
- **修复**：`fc80e9ca2` 增加 primitive `questionSourceStageRevision: number | null`，只取历史 `readAidtQuestionSnapshot`，不借用当前阶段或 `sourceStageRevisions`。UI及教学规则明确这是学生记录、尚未核实的关联。
- **验证**：[source-revision-red.log](a2/source-revision-red.log) → [source-revision-green.log](a2/source-revision-green.log)：精确反例先失败，修复后2文件43项通过；含历史V2与当前/其他引用V99并存、缺失仍为null。见[source-revision.md](a2/source-revision.md)。没有额外请求或新反向引用服务契约。

## 3. 保留旧报告正文，保存时却错绑到新阶段来源

- **问题/复现**：旧报告正文讨论第5步V1；刷新后表单正确更新为V2。学生只追加写作说明再保存，旧实现却发送第5步V2及当前第6步来源，而正文没有改为讨论V2。
- **修复**：`8ad1bf1bc` 将报告来源随原稿捕获：服务器hydrate/恢复使用已有来源；人工编辑、历史章节追加和阶段刷新保持原来源；只有学生明确重新组装正文才换来源。未知手写稿保留来源缺口，冲突审阅不嫁接对方来源。
- **验证**：[report-source-red.txt](a3/report-source-red.txt)真实失败 → [report-source-green.txt](a3/report-source-green.txt)38项hook回归通过；[report-source-api-existing.txt](a3/report-source-api-existing.txt)现有旧修订引用后端单元1项通过。详见[report-source-fix.md](a3/report-source-fix.md)。后端证据是内存端口，不代表本轮真实数据库往返已通过，也不会自动修复过去已经错绑的来源。

## 4. 真实原型 ID 尚不能随阶段稿保存，冻结快照只比较文字

- **问题/复现依据**：初版选择器能返回原生版本元数据，但父级阶段稿及问题快照仍以文字引用为主；相同标签不足以标识实际版本，S5改选与S6旧快照需要明确分离。这是源码接线缺口，没有宣称存在正式修前红日志。
- **修复**：`3c45e93c3` 增加结构化引用字段的读写/校验；问题快照保留可选 `prototypeDesignId`/`prototypeVersionId`，兼容旧schema1。手工修改版本文字清除原生选择标记；改回旧标签不恢复ID；S5改选不改既有S6快照。`0e91f1714` 将真实版本文本框和picker回调接入宿主，并使S6显示与校验使用同一版本不一致判断。
- **验证**：[reference-persistence-tests.log](a5/reference-persistence-tests.log)10文件64项通过；[integration/web-644.log](integration/web-644.log)包含真实StageOutput宿主集成断言。覆盖StageContent JSON往返、S5 V1→V2而S6仍V1、ID匹配、手工旧标签不恢复ID、S6另选版本警示。结构解析不证明当前授权、内容真实性或测试有效；没有实际原型生成验收声明。

## 5. 移除原型引用后，迟到的另选结果将其重新填回

- **问题/复现**：已有引用A → 开始核对版本B并延迟响应 → 学生点“移除版本引用”得到null → B回包，旧完成回调再次写入B，覆盖学生移除决定。
- **修复**：`aaaf31d6f`（worker原SHA `482ea8fa8`）移除时同步abort当前选择，清pending/error；成功回调核对当前controller。取消逻辑与收起/刷新复用。
- **验证**：[removal-race-red.log](a5/removal-race-red.log)1项真实红测 → [removal-race-green.log](a5/removal-race-green.log)完整helper/picker20项通过，含移除后能重新选择。独立审阅也用同一时序复现后复验通过；不把两个测试作者计为两轮修复。

## 6. 旧 success 回包恢复已经收紧的成员聊天权限

- **问题/复现**：旧history请求挂起 → 新poll已将频道降级为只读/归档或发现移除 → 旧 `canWrite:true` success迟到，重新开放编辑，部分分支还会重显已撤权正文。旧topic success及发送只读回执有同类时序。
- **修复**：`ff0b0d3ef`（worker原SHA `69c39caa7`）在共享store保持访问限制版本；旧读取只能更新仍属当前访问版本的数据，不能撤销新限制或恢复清除的内容。
- **验证**：[before.log](a4/before.log)4个新反例失败、原21项通过 → [after.log](a4/after.log)5文件55项通过。四个同形反例合为一项权限收紧反馈；不是四次课堂或四轮独立产品迭代。

## 7. 旧 error 回包撤销后来已经恢复的成员聊天权限

- **问题/复现**：旧history/topic挂起 → 新poll先降只读 → 更新poll恢复可写 → 旧404最终触发 `clearAccess` 并停止后续poll。它与上一条方向相反：过时错误错误地覆盖了更新的有效授权。
- **修复**：`956b50335`（worker原SHA `00dde40af`）为历史错误加入版本guard；过时topic错误仅保留局部失败/重试，不清除更新的频道授权。当前有效404仍必须清缓存并禁止发送。
- **验证**：[stale-error-before.log](a4/stale-error-before.log)两条新增反例失败、原25项通过 → [stale-error-after.log](a4/stale-error-after.log)5文件59项通过，含有效404的反向保护、草稿保留、topic重试及后续poll继续。两项权限反馈均是受控HTTP/组件验证，不能冒充真实成员撤权网络交错验收。

## 8. testid 门控遗漏 features 源码目录

- **问题/复现**：A6执行canonical门控实际失败；其 `SOURCE_ROOTS` 未扫描 `apps/web/features`，把已存在的原生AIDT锚点误报为不存在。只读对照发现基线已有多项同类遗漏，不能靠新增豁免掩盖。
- **修复**：`0e91f1714` 将实际features目录纳入门控扫描，并补覆盖该目录的回归。
- **验证**：修前[testid-gate.txt](a6/testid-gate.txt)及[testid-scope-audit.json](a6/testid-scope-audit.json)；修后[integration/testid-gate-tests.log](integration/testid-gate-tests.log)36项门控测试及[integration/testid-gate.log](integration/testid-gate.log)全局扫描通过。门控本身的通过不等于其检查的浏览器场景运行通过。

## 9. 完整类型检查揭示三处新增测试 fixture 的类型错误

- **问题/实际诊断**：新增测试运行可过，但完整TypeScript检查报告：返工测试的 `item.fields.returnReason` 可能未定义；原型同ID改名断言直接传入额外属性的对象字面量；共享阶段fixture没有收敛到正式StageDraft类型。这三处属于同一次集成类型反馈，合为一项，不凑三轮教学迭代。
- **修复**：`0e91f1714` 中显式检查returnReason确为字符串后再验证截断；将改名对象独立命名后仅以ID比较；使用现有 `StageDraft.parse` 构造fixture。未放宽生产契约、删断言或用类型压制。
- **验证**：[integration/web-typecheck.log](integration/web-typecheck.log)完整Web类型检查通过；[integration/web-644.log](integration/web-644.log)包含对应回归，详见[integration/README.md](integration/README.md)。返工测试单独8项、目标文件TypeScript诊断0及ESLint通过也在本轮实际执行。原始三项诊断由root本轮执行发现，仓内没有该次完整红日志，因此不补造“红日志”文件或测试失败计数。

## 10. 纯报告格式化经 label helper 牵入 API 适配器

- **问题/复现依据**：第三绑定增量的纯历史/报告格式化从原型适配器导入label，传递加载 `api-client` 与contracts总入口，使仅解析学生历史文本的路径依赖原生读取适配器。源码导入链被独立检查确认；未保存正式修前红日志，不将源码审阅称为浏览器失败。
- **修复**：`41bac9306` 将唯一label实现移到纯 `aidt-prototype-label.ts`；旧适配器re-export兼容，reference/verification改用纯helper及既有契约子路径。历史格式化同时只称“学生保存的页数记录/结构可读”，不声称过去真实读取成功、当前已授权或证据通过。
- **验证**：[pure-formatting-tests.log](a5/pure-formatting-tests.log)原64项加runtime poison边界断言共65项通过；[pure-formatting-eslint.log](a5/pure-formatting-eslint.log)通过。poison断言禁止加载API client、适配器及contracts总入口后，完整报告仍能格式化。元数据措辞反证见 `aidt-prototype-reference.test.ts`；这是结构与依赖边界验证，不是原生服务读取或模型验证。

## 尚在处理：Design 教学材料交接

**状态：处理中，未整合，不计入上述已修复闭环。** 静态可复现路径为：S5确认并保存独特验证问题 → 打开关联Design。当前 `project-aidt.tsx` 只传designId；原生Design的发送文本来自自己的输入值，尚未携带S5问题卡、先前看法、HMW或入选描述单。S6的Design入口也不能仅因S5曾确认，就推断旧问题材料已正确带入。

负责人正准备host adapter/原生composer显式offer候选：读取已保存来源，学生审阅后再发送；S6/returnRevision场景应读取冻结S6及其确切旧S5，不能替成新S5。候选位于临时工作目录，尚未成为集成源码；当前定向测试结果未确认，不写为通过。不得由此宣称真实Design生成、真实模型接收材料或教学效果已验收。

## 原生执行与交付边界

- [acceptance-boundaries.md](acceptance-boundaries.md)是当前验收范围的统一索引；本记录是问题闭环的证据索引，不重复维护一份功能完成清单。
- `attempt-full-01`实际退出1，停在构建断言；缺失Next worker文件，因此该次没有跑通新增报告/历史/成员文字端到端链。
- 收尾时只读核对真实 `attempt-full-02/execution.json`：`finishedAt=2026-11-16T02:06:26.116767+00:00`、`exitCode=1`、`durationMs=249886`，该次已结束且未通过。此前构建退出0及浏览器阶段进度不能抵消最终失败，**不能称完整原生双停启、新登录回读、报告或成员文字验收通过**。失败原因由root核对运行日志，本记录不猜测；root据完整回执更新统一验收索引。没有从中间截图/日志推断成功，也没有继续沿用“仍在运行”的旧状态。
- 本轮不同Web测试总数以集成说明的去重口径为准：首批644项加另外6项为650项；反馈60项含54项复跑，不能再加成704项。每条局部绿测同样不能累加成课堂轮数。
- 本记录没有运行新测试、启动服务、修改源码、创建GitHub外发、部署生产或改变人类设计签核。真实模型六步教学行为、真实证据/访谈授权、实际Design生成、约30人课堂和跨平台实机仍须独立验收。
