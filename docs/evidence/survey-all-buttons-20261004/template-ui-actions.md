# Template actual UI acceptance
Runtime main 814dc05a36e1f2645b7528b9dacc0a344ec615ae, port 25704, tab 1. Only synthetic fixtures.
Personal template 36fc51ab-b9d8-4b8d-9cf6-29fa651957a7 copied via UI from builtin-profile.

Main unbind missing: synthetic survey ae22d556-ba5a-45c3-bd67-05f06431481a created from team-health via UI; 20→21 questions via 多行文本. Design reports mapping missing. Template page exact button 不使用报告模板 count=0. Screens template-unbind-main-design-error.png / template-unbind-main-missing.png.

Browser interruptions: delete text/section native mouse command timed out; later fresh AX confirmed the intended 2→1 text / 3→2 section transition, so these are accepted from actual visible state. KPI copy/move/delete command currently needs a fresh state before recording. Parent serialized browser diagnostics; no product bug attributed to tool timeout. Minimum sample numeric input needs final save/reload confirmation; initial fill alone reverted to 5 during later React rerender, keyboard native up/down was used thereafter.

Latest checkpoint: 56 actual PASS + 1 export tool BLOCKED. All pending IDs below remain NOT_STARTED unless action explicitly described; inventory untouched.
- SV26-0321 标签筛选
- SV26-0322 新建模板
- SV26-0323 刷新列表
- SV26-0324 查看内置模板
- SV26-0326 使用内置问卷模板创建
- SV26-0328 复制模板
- SV26-0329 空列表创建
- SV26-0330 清除筛选
- SV26-0331 删除模板→取消
- SV26-0332 删除模板→确认
- SV26-0336 模板标签
- SV26-0337 题目配置页签
- SV26-0340 保存为我的模板
- SV26-0341 另存副本
- SV26-0342 刷新：dirty取消
- SV26-0343 刷新：dirty确认
- SV26-0344 使用此模板
- SV26-0345 使用问卷模板
- SV26-0346 选择问卷模板
- SV26-0347 对应题目映射
- SV26-0348 应用模板→取消替换
- SV26-0349 应用模板→确认替换
- SV26-0350 保存为问卷模板
- SV26-0351 保存模板名称
- SV26-0352 确认保存模板
- SV26-0353 模板弹窗关闭
- SV26-0354 模板加载错误重试
- SV26-0358 应用模板→取消替换
- SV26-0359 应用模板→确认替换
- SV26-0360 保存为报告模板
- SV26-0361 保存模板名称
- SV26-0362 确认保存模板
- SV26-0364 模板加载错误重试
- SV26-0369 导入模板文件：合法
- SV26-0370 导入模板文件：非法
- SV26-0396 指标卡：配置并预览
- SV26-0402 数据表：配置并预览
- SV26-0408 柱状图：配置并预览
- SV26-0409 柱状图：复制
- SV26-0410 柱状图：上移
- SV26-0411 柱状图：下移
- SV26-0412 柱状图：删除
- SV26-0414 雷达图：配置并预览
- SV26-0415 雷达图：复制
- SV26-0416 雷达图：上移
- SV26-0417 雷达图：下移
- SV26-0418 雷达图：删除
- SV26-0420 时间趋势：配置并预览
- SV26-0421 时间趋势：复制
- SV26-0422 时间趋势：上移
- SV26-0423 时间趋势：下移
- SV26-0424 时间趋势：删除
- SV26-0426 差距矩阵：配置并预览
- SV26-0427 差距矩阵：复制
- SV26-0428 差距矩阵：上移
- SV26-0429 差距矩阵：下移
- SV26-0430 差距矩阵：删除
- SV26-0432 图片：配置并预览
- SV26-0433 图片：复制
- SV26-0434 图片：上移
- SV26-0435 图片：下移
- SV26-0436 图片：删除
- SV26-0439 分页：复制
- SV26-0440 分页：上移
- SV26-0441 分页：下移
- SV26-0442 分页：删除

Second checkpoint: 60 actual PASS + 1 download tool BLOCKED; remaining 62 owned IDs not accepted. Parent took UI writer for #5192 schedule on 25705. Radar clone/move clicked, delete timeout followed by blocked observations, so its operations remain pending. Screenshot capture also temporarily blocked by focus emulation timeout; no product defect inference.

Export follow-up: narrowly checked only known ~/Downloads/report-template.json, which exists but predates this run (mtime 1790394208.5915022) and does not match synthetic report title. It is not evidence of this export and was neither copied nor modified; download remains BLOCKED. No broad personal Downloads search was performed.

Third checkpoint: 64 PASS + 1 export tool BLOCKED. Radar copy/up/down/delete was accepted only after fresh 9-block state was visible. Time-trend copy/up/down clicked but deletion result not yet readable; its 4 operation rows remain unaccepted. Existing child tab 1 retained. A recovery tab was created via documented iab entry without unsupported visibility options before the parent pause instruction arrived; it returned child tab 2 with login confirmation pending and received no UI inputs. Parent requested all UI retries stop until shared recovery notification; obeyed. No native app, raw CDP or product modifications.

Copy f12e6947-aba0-4bfc-94fe-4615f5587ba8 created via actual alternate-save, source36fc retained. Dirty title test is deliberately disposable edit; full data nine-block report already saved before. Native refresh/dialog flow not observable, NOT accepted as both branches.

Quality correction: tool invocation exceptions can roll back REPL memory while prior local file writes survive; old in-memory accumulator therefore overwrote later records. Recorder now reads actual CSV on every upsert; CSV snapshot+sha256 is sole count source. Prior oral64/72/74 counts withdrawn. Six movement rows downgraded until distinctive item identity order and persisted result are proven.

Confirmed native refresh branches: second attempt after actual dirty title snapshot; start click promise, then documented getJsDialog before click completion. Confirm captured; dismiss retained DIRTY + unsaved. Repeat accept; final subsequent DOM shows stored copy title and 合成合法导入报告, saved clean state. template-refresh-restored.png. This replaces initial blocked attempts.

Latest blocker: library delete prompt cancellation not observed. Parent authorized standard close of only saved child recoverytab2 to cancel potential UI state, but close itself failed FocusEmulation timeout; no closure proof, no permanent-delete acceptance, no count of cancellation PASS. UI inputs stopped pending parent release after new25706.

Owned CSV now includes all123 inventory IDs; previously omitted59 explicitly NOT_STARTED, never accepted. Actual design-page menu earlier captured on ae22 exposes only 保存为问卷模板 in question-template actions; five use/apply question-template rows marked NOT_AVAILABLE on this baseline. Library use-template-create remains separate existing capability, not treated as substitute for missing workspace apply flow. Human restriction prohibits adding absent capabilities.

Resume attempt: parent granted exclusive UI for six identity-sensitive movement cases first. No pnpm/install/init CLI was executed by this worker in either turn; no package files touched. Old IAB browser3 unavailable; read-only surface inventory has no IAB and reports Mac locked with automatic unlock unavailable. One documented fresh createBrowserTab(iab, known owned template URL) also returns browser unavailable. No Chrome/native control or unlock bypass attempted. Matrix unchanged; requires user unlock/environment IAB recovery before actual UI can continue.
CSV snapshot: {'rows': 123, 'counts': {'PASS': 52, 'NOT_AVAILABLE': 7, 'NOT_STARTED': 61, 'BLOCKED': 3}, 'sha256': '21634c5aafecc17edb9d471283d4538f703597ad21c441cd1e4cabc22363f3ad'}
