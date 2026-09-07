# Additional real-model Skill scenarios (in progress)

All inputs are agent-authored synthetic fixtures in new `*-real-model.cases.ts` files. The actual configured qwen3.8-max model uses the official native graph and existing owned sandbox, API controllers, tenant repositories and artifact writeback. No production user data, recording or credential is included in prompts or evidence. Source implementation S009 remains unchanged.

## 20 项目录验收覆盖索引（2026-09-07 只读审计快照）

本表仅索引 [capability-catalog.json](../../capability-catalog.json) 的验收条款与已执行证据，不修改 feature/passing 状态，不是第二份状态源。“当前包”指本工作树可读取的完整包；不推断每个组织已安装或旧 pin 自动升级。真实模型版本必须与证据记录匹配，旧包结果不自动继承给新包。所有 live 场景仅合成资料；文件均要求真实写回，人工复核另列。下列“仍需”严格区分目录必需与可选扩展。

| ID / Skill | 当前包；真实模型验证版本 | 实际模型、产物与人工证据 | 目录必需剩余 / 可选边界 |
|---|---|---|---|
| S001 组织知识问答 | standard-context 1.1.0；已验1.0.0 | [S001人工复核](../g-skill-batch/S001/REVIEW.md)：真实知识search/read、原文引句与版本、answer.md写回、零工具负例 | 1.1.0尚需重验；代表场景是当前thread来源，撤权后不再引用、完全无结果与可点击引用仍须以对应实际验收覆盖，不能只拿方法包文字证明 |
| S002 联网研究 | standard-web 1.1.0含web-research 1.0.0；已验pack1.0.0同Skill版本 | [S002最终复核](../g-skill-batch/S002/REVIEW.md)：真实搜索2次/fetch5次、4页全文1失败、来源ID/hash核对、报告写回、预算表、零工具负例 | 当前场景通过；冲突来源保留须由明确冲突fixture或独立证据覆盖，网站永远可用不是承诺；实际JSON全Skill对象对比已确认pack1.1.0内web-research与1.0.0完全相同 |
| S003 Word | 平台docx-create内容寻址包，非starter semver；创建场景已验 | [S003真实模型复核](../g-skill-batch/S003/REVIEW.md)：双语两页/表格/实际页眉，DOCX/PDF/PNG写回、原尺寸目视、零工具负例；首次预算编造失败保留，页眉误判已纠正 | 创建代表场景通过；目录指定段落编辑与无关段落不变仍需对应证据，不扩大任意DOCX布局/编辑 |
| S004 表格 | 平台xlsx-create内容寻址包；创建场景已验 | [S004真实模型复核](../g-skill-batch/S004/REVIEW.md)：三原始行与双语标题、SUM真实公式/cache30/12/42、两页PDF独立渲染目视、写回、零工具负例 | 创建/公式样例通过；目录指定单元格编辑且其他表不变仍需独立对应证据，资源限制是组件边界；不承诺任意公式重算 |
| S005 演示文稿 | 平台pptx-create内容寻址包；live未跑 | [W09组件](../W09/README.md)、[逐页渲染样例](../W09/renderer/README.md) | 必需：真实model创建/精确文本替换、中文字体/图片逐页检查、未知对象明确拒绝；任意复杂文件无损不在范围 |
| S006 PDF | 平台pdf-create内容寻址包；live未跑 | [W09组件](../W09/README.md)、[PDF渲染](../W09/renderer/README.md) | 必需：真实model中英文可提取+目视、页序、表单写值重开；当前页复制脚本不保证表单保留，不能当表单验收；覆盖矩形不是安全涂黑 |
| S007 数据分析 | data-workflows1.0.0；已验同版 | [S007复核](../g-skill-batch/S007/REVIEW.md)：真实计算A40/B12/总52，三文件analysis.md/analyze.py/result.csv写回，缺失/重复策略、零工具负例 | 已验样本数值与非因果表述；[独立重跑](../g-skill-batch/S007/independent-replay.txt)在新隔离session原样执行实际发布脚本两次，CSV字节均与发布结果一致。脚本固定输入路径、全缺失组泛化及措辞问题已保留，不冒充任意数据集通用质量 |
| S008 会议准备 | standard-context1.1.0；已验1.0.0 | [S008复核](../g-skill-batch/S008/REVIEW.md)：真实授权来源、背景/议程/问题/缺口、报告写回、零工具负例 | 1.1.0尚需重验；完全无资料场景需明确覆盖。未发送邀请是预期，不能增加发送工作 |
| S009 会议纪要 | standard-audio1.1.1中meeting-minutes1.1.1；已验同版 | [严格live](../W14/audio-real-model/README.md)：实际模型读完整技能与合成转录、决策/未决语义人工核查、定位、产物写回、零工具负例 | 转录输入代表场景通过；[60分钟源链](../W14/audio-long/README.md)是实际传输/解码+受控ASR文本组件证据，不是供应商准确率。无需为给定转录再次ASR |
| S010 访谈综合 | standard-methods1.0.1中interview-synthesis1.0.0；已验pack1.0.0同技能内容 | [报告](S010/report.md)及trace：3记录/2人、重复不计、异议原句/定位、无人口属性编造、写回、零工具负例 | 本合成场景覆盖目录主要语义；1.0.1构建验证保持S010对象与1.0.0相同。任意组织研究库路线不据此宣称已验 |
| S011 组织沟通 | standard-context1.1.0；已验1.0.0 | [报告](S011/report.md)：计划已批准但未上线、日期/指标未知、草稿无发送、写回、零工具负例 | 1.1.0需重验；权限失效反证依赖真实底层读权限证据，不能仅把合成资料无敏感内容当ACL证明 |
| S012 图表画布 | standard-canvas1.0.0；已验同版 | [报告](S012/report.md)及trace：实际canvas read/update/read，revision1→2，ID/edge保留；旧revision冲突、intruder读取拒绝 | 本次源变更通过，UI像素未验；目录无权限写入必须由W11实际写拒绝测试覆盖，读拒绝不能替代写拒绝 |
| S013 网页产物 | standard-web1.1.0中web-artifact1.0.0；live未验 | 当前等待生产browser/隔离预览路径，未用静态截图冒充 | 必需：真实按钮/空状态、移动无横溢、网络拒绝、源码/预览/测试记录和真实model。生产部署平台明确已删，不应复活 |
| S014 项目报告 | standard-context1.1.0；已验1.0.0 | [报告](S014/report.md)与真实project list/read：observedAt/人数/空agenda/blueprint一致，未知预算不猜，写回、零工具负例 | 1.1.0需重验；原1.0.0代表场景满足实际API事实要求。不能以纯overview文本替代API；新增预算模型明确不做 |
| S015 技能草稿 | standard-authoring1.0.0；已验同版 | [最终报告](authoring-final/S015/report.md)、[独立脚本反证](authoring-final/S015/independent-script-fixtures.json)：实际model创建6文件包、脚本正3/负拒绝、两产物写回、未启用、零工具负例 | [新包第二隔离模型场景](remaining-first/S015-generated/model-trace.json)已通过：挂载实际生成包、自动加载count-sum、运行原脚本得到3、报告写回，算术0工具；缺脚本/权限提升由[W15实际门禁](../W15/README.md)分别覆盖。无需新发布器 |
| S016 音频转录 | standard-audio1.1.1中audio-transcription1.1.0；live未验 | [60min真实源链](../W14/audio-long/README.md)：MP3→FFmpeg→120现ASR会话→转录JSON写回，损坏/空声/权限反证 | 必需G-SKILL尚阻于真实ASR配置缺失；不得拿text-model key替代ASR授权或受控WS文本替代供应商。时间是源块边界，不是词级/实名说话人 |
| S017 视觉内容 | standard-visual1.0.1；已验同版 | [新版报告](revised/S017/report.md)、[PNG](revised/S017/poster.png)：800×600精确两段中文、预装字体/几何素材、实际写回、人工看图、零工具负例 | 目录依赖仅E004/T008/T020，且“生成式提供者按需”，所以离线PNG满足本场景；供应商图片生成是独立可选路径，未据此验证。旧像素⇒字形错误报告保留 |
| S018 | standard-document 1.2.0（实际 packDigest 见 result.json） | 真实双输入模型：跨页表格 + 扫描图；[最终证据](document-final/README.md) | 4 数合计 1140、真实页/单元格定位、OCR 75/币种缺失、两原件 hash、实际写回及零工具负例通过；已人工比对结构与原扫描图 | 该目录代表场景通过；不外推任意 OCR 准确率，此前并发 409 失败保留 |
| S019 研究规划 | standard-methods1.0.1中user-research-planning1.0.1；已验同版 | [新版报告](revised/S019/report.md)：含结束/追问的O1/O2映射、未完成/退出者招募、跳过/录音可选、未虚构研究、写回、零工具负例 | 本合成规划场景通过；旧无映射/幸存者偏差报告保留。未执行招募/研究是范围要求，不新增第二研究系统 |
| S020 数据可视化 | data-workflows1.0.0；已验同版 | [报告](revised/S020/report.md)、[PNG](revised/S020/chart.png)、[实际脚本](revised/S020/chart.py)：10/20、零基线、C缺失非零、中文可见，3文件写回、零工具负例 | 本合成场景通过；可复现脚本绑定原session输入路径，异地运行需提供源并改路径；任意缺失/图形泛化不承诺 |

Office 当前包版本由 `officeSkillPackage()` 的完整文件摘要绑定，2026-09-07实际读取为：docx `d84e48361ca618c7198c409901d88b0ec023d0972a47322db860f97ee9bd75e7`，xlsx `1a3079fb95077b8e457921219e637ac60f98e32528d6e7cc6951afe116eb9783`，pptx `a1da34fabd0e941187f99e38092be9f0f1be3f12dc3edd97fb909b926ed5fe91`，pdf `549fbd5a970d228832c1a935ccf7d933fe198f817e3b0ed0c0d2090947bdce90`；完整versionId为`skill-platform-<stableName>-pkg-<digest>`。这些是包身份，不是已装组织版本或模型验收结果。


`first-batch-tests.txt` contains 2 passed/2 failed. `extended-first-tests.txt` contains 5 passed/1 failed, with two intentionally filtered earlier cases skipped. These mixed groups are not global passing claims. Each failure and each remaining semantic issue stays visible. New immutable method versions preserve prior packages; root owns platform seeding.

The first S019 HTTP400 is retained. The exact 8643-byte synthetic write command subsequently succeeded through direct UDS in the same image (`long-command-direct-replay.txt`), and the image's actual maxCommandBytes is 65536, ruling out the earlier suspected 8192 limit. New batch relay streams now use streaming UTF-8 decoders rather than `Buffer`-chunk string concatenation. A local split-multibyte counterexample demonstrated corruption with the old pattern; the original failing chunk boundaries were not captured, so the root cause is not overstated as conclusively proven.

DB use is sequential and explicitly handed off. The owned sandbox project `wx-method-skills-real` was stopped and removed with its sessions_socket volume after final S015 acceptance; future S018 uses a separately prepared image/project. No other agent's stack is modified.

## Revised batch, 2026-09-07

Four real-model cases ran in one isolated wrapper: S017, S019 and S020 passed; S015 failed at graph recursion limit 200 after 18 actual tool calls. Wrapper cleanup completed; peak PostgreSQL connections 3. The limit was not increased. Original failure and revised traces are retained separately.

Manual review of revised artifacts: S017 poster has the exact two Chinese strings with no clipping/tofu; report accurately states model-side visual verification was unavailable and does not treat pixel statistics as glyph proof. This only verifies the offline poster scenario, not supplier image generation. S019 questions including closing and follow-ups are mapped to O1/O2; recruitment includes unfinished/dropout users; declining recording or sensitive questions is not exclusion. No research was claimed performed. S020 PNG shows values 10 and 20, zero baseline, Chinese labels and explicit missing third group; report and separately published chart.py preserve missing rather than zero. Its script contains the actual session input path, so reproduction outside that session requires supplying the saved source and adjusting INPUT_PATH. These are bounded synthetic scenarios, not universal quality certification.

S015 failure trace previously saved tool calls but not intermediate tool results/node names, so the precise final publish outcome cannot be inferred. The new batch runner now records sanitized actual ToolMessages, last message, state keys and node-update names for the next reproduction; no production graph changes were made.

## S015 graph-budget counterexample

`authoring-observed-tests.txt` and `authoring-observed/S015/partial-model-trace.json` show 200 updates, 18 model calls and 17 completed tools. Each ordinary tool round traverses 11 nodes; startup adds five nodes. The graph stopped during the eighteenth after-model chain, not because the model repeated 200 calls. The first artifact publish returned success; the next report publish had not dispatched. `authoring-node-count.json` contains actual counts. The live-only 200/100 recursion overrides were removed after root review to match production's installed LangGraph default; the existing 25-model-call harness cap and 240-second process timeout remain unchanged. No production routing/middleware was changed. A subsequent real-model rerun is required before S015 acceptance.

### Reproduction commands

Load configuration without printing values using `source scripts/real-model-env.sh` and `real_model_load_env_file /Users/shenyanbin/Documents/workspacex`. Set `WX_NATIVE_SANDBOX_CONTAINER` to the owned inputs-capable container and `WX_AUDIO_REAL_EVIDENCE` to a private temporary evidence directory. Run `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run --config vitest.extended-skills-real-model.config.ts -t 'S019|S015|S017|S020'` for the revised batch; `vitest.authoring-skill-real-model.config.ts` selects the bounded S015 reproduction alone. These explicitly named live configurations require real model credentials and are not ordinary CI tests. Never load production documents into these synthetic cases.

Default-settings S015 model completed successfully and staged both the complete JSON package and `count-sum-verification-report.md`; the test then failed because its report lookup required the literal download name `report.md`. The report lookup now permits a descriptive report filename while preserving content checks. The failed fixture evidence remains in `authoring-default/`; independent package-script execution and actual writeback still require the final rerun.

## S015 final acceptance

`authoring-final-tests.txt`: 1/1 passed, test69.53s, wrapper1m13s, peak3connections, cleanup completed. Actual model selected and read the complete Skill, created a six-file draft package, staged JSON plus verification report, and the existing writeback created two artifact versions. `authoring-final/S015/independent-script-fixtures.json` proves separately extracted package script was executed in the actual sandbox: positive total3/exit0, negative rejected/exit1, neither truncated/timed-out/cancelled. Arithmetic negative used zero tools. Manual script/report/final-response review found the synthetic requirement preserved, no network/install, and explicit draft/not-enabled/admin-import-required semantics. This does not verify arbitrary generated code safety, large-file performance, or administrator import in this live scenario (the dedicated W15 governance tests cover that separate boundary).

## Generated Skill and S018 first required-scenario batch

`remaining-first-tests.txt`: generated Skill 1/1 passed; S018 1/1 failed; wrapper cleaned up in one second, total36seconds, peak3connections. The generated Skill is the exact six-file JSON previously created by the real model (packDigest `4f3b50737e7827371ab3452bb698bf7b8cef8235be5f6ca9ec27eb8ba4d0a2c5`). A separate random run mounted it only inside the isolated test fixture; no administrator publication or Skill activation was performed. The actual model read this new Skill, executed its actual `/skills/count-sum/scripts/sum_counts.py`, produced total3, and wrote back the report. The arithmetic negative used zero tools. Manual report review matches the actual output and path.

S018 supplied the committed synthetic two-page repeated-header PDF and a newly generated raster scan. The real model requested chunks for the PDF and OCR for the image concurrently in one response. `remaining-first/S018/transport-failure.json` records actual HTTP409 SESSION_BUSY. The tool raised its explicit unavailable/refused error; no parsed result was fabricated. This is a production concurrency boundary, not a reason to tell the model to avoid parallel calls. Root has the exact trace for coordination; this worker has not changed shared factory/graph or weakened sandbox execution isolation.

### 撤权证据的读取边界

现有W08真实HTTP用例证明下一次parse会重新检查来源权限。目录S018“权限失效后不可读取缓存”还需要不同反证：成功parse后撤权，在仍active的run内再通过原生read_file/execute读解析缓存。当前通用tool check路径（RunInterjectionController → ToolExecutionAuthority → PgParentRunControlReader）检查run/lease/approval，不读取当前组织成员/线程可见性；原生HTTP session token读取缓存并不自动再次调用parse。该边界已交root协调，不能把下一次parse拒绝标成缓存读取撤权已验。

Resource handoff: after the first S018 failure, the owned wx-document-real sandbox and its sessions_socket volume were removed with the original Compose down --volumes command while the shared dispatch repair is pending. No owned database, browser or sandbox remains running. The immutable w08-locators image and task-only override can recreate it for the unchanged scenario.
