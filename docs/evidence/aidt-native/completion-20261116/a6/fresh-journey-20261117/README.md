# 新组织同组原生验收：实际结果

本轮已结束模型与浏览器操作。7个原生引导师逻辑任务实际6个成功、S5取消；另有2个真实Design生成任务。**不能判完整原生链全通过**：S5由明确人工合成学生稿接续，AI报告也需要学生核对更正。全部资料均合成，实际actor为正常seed的funded admin/项目owner，不证明普通学生资金、真实研究或课堂教学效果。

[完整机器索引](./final-machine.json)保留逐任务run、物理调用、reported/unknown和原红/续完；[独立内容审阅](../../a3/fresh-round-content-review.md)、[独立服务端来源审计](../../a2/fresh-completion-audit-20261116/README.md)分别评价内容与版本，不用UI wire/hash代替真实研究或模型理解。

| 项目 | 实际结果 | 证据/边界 |
| --- | --- | --- |
| S1 | 原生任务成功；学生主题初稿V1→回答/重写/确认V2，重登精确回读 | [turn](./s1-actual-turn.json)；严格单一问句未满足，实际核心问题带3个问号选项，教学非全过 |
| S2 | 原护栏中断保留；正常UI一次许可同run续完，学生V3→V4保存/重登 | [原中断](./s2-first-interrupted-run.txt)、[续完](./s2-continuation-attachments.json)；模拟替代实访的引导有方法边界偏离 |
| S2清单 | 实际beforeprint→真实打印DOM副本→Chromium PDF字节/文本核验通过 | [146318B PDF](./student-reviewed-interview-guide.pdf)；不是模型生成文件或OS另存窗口自动化 |
| S3 | 原用例实际通过208.8秒；暂无/画像未知/待验证HMW由学生确认保存V2 | [turn](./s3-actual-turn.json)；44 physical，1条unknown/pending，保性能与结算问题；没有timeout红/没有cancelPOST |
| S4 | 3个不同点子、3张真实上传图、多标签/选择保存；另免费补独立入选理由V4 | [actual](./s4-attachments.json)、[理由V3→V4](./s5-cancelled-attachments.json)；分类理由与入选理由分开 |
| S4描述单 | 3份真实PDF，各自标题/描述/图decode与字节SHA通过 | [PDF1](./s4-candidate-1-actual-pdf-b8acbf98ea3e893b5f718c6564bd43fe574101f3.pdf)、[PDF2](./s4-candidate-2-actual-pdf-99c3151d9c0e222536355bc2bd92c60051a44d7e.pdf)、[PDF3](./s4-candidate-3-actual-pdf-743fbd1c54a5452603430535b4c74fa23f193c33.pdf)；不是仅beforeprint事件 |
| S5引导师 | **取消，未通过**；15 physical后按本轮有界测试规则正常API取消，无最终回复 | [原红](./s5-cancelled-run.txt)、[原来源/失败附件](./s5-cancelled-attachments.json)；不重发、不改原失败outcome |
| S5学生接续 | 正常UI人工确认合成问题/先前看法/依据/限制/形式/触点操作，V2保存+重登 | [实际学生稿](./s5-manual-student-fallback.json)；QA仍保原s5 attempting，独立manualContinuation不等模型成功 |
| Design V1/V2 | 两个真实生成任务source=model、不可变seq1/2、真实UI绑定与旧snapshot保留 | [A5真实版本与页面](../../../completion-20261117/a5/fresh-design/README.md)；V1无号码映射/无交互，V2补明确合成2→B示意，均非真人测试 |
| S6 | 原护栏中断保留；正常UI一次许可同run续完；学生V3→V4 return2/unchanged/确认保存+重登 | [turn](./s6-actual-turn.json)、[纠正后学生稿](./s6-continuation-attachments.json)；通用TXT不是V1实测；无认识变化不强制新版 |
| S6版本关系 | 旧V4 return2→V5另选return5→V6关联V2，旧S5V3问题snapshot不被当前S5V4新题覆盖 | [A5实际关系](../../../completion-20261117/a5/fresh-design/v2-result.json)；后续V7/8/9报告保存不另算学习轮次 |
| SUM技术流程 | 独立summary线程/pin；原护栏中断后同run一次许可续完；实际3070字符草稿审阅导入→V8保存/重登/精确MD导出 | [actual turn](./sum-actual-turn.json)、[原AI稿](./sum-selected-ai-draft.md)、[原8613B导出](./student-reviewed-full-report.md) |
| SUM内容 | **未完整通过**；遗漏实际V2及旧→新演变，未披露truncated=true；不以正确refs证明读了完整正文 | 原AI/V8/旧导出不改，不重发求漂亮结果 |
| 学生报告更正 | 真实GET逐版核对后在报告UI追加更正→V9保存/重登/精确新MD导出通过 | [最终学生11664B报告](./student-corrected-final-report.md)、[V8→V9全证据](./student-report-correction.json)；学生补记不冒模型已读全；原refs/draft保留 |

## 调用、失败与接续

唯一Native逻辑任务记录共7条；S2/S6/SUM的审批与checkpoint恢复不是新human send，不新增reserve。三份旧journal和此前失败/pending未重置。两Design任务独立记录，不藏入native次数。[机器索引](./final-machine.json)逐项列实际physical/reported/unknown及结算来源。S3的一条failed-unknown usage/pending与63.46测试credit占款原样保留，不猜0用量、不手工结算或释放。

阶段一旦卡住，保留证据并继续独立能力。本轮90秒无终稿或>12 physical且持续running的停止条件是**QA操作者规则**，不是新生产模型预算/自动超时产品功能。S3早于该规则已实际晚完成；S5按规则取消。原s5 QA状态attempting用于保留失败记录，不代表生产任务仍running，后端终态为cancelled。

## 真实文件与边界

所有PDF均有实际文件字节、SHA与文本核验；打印文档中的图片真实decode。PDF来自实际产品beforeprint DOM副本的Chromium生成，原生打印事件未mock，但OS另存窗口没有自动化。两份报告Markdown分别是原AI导入版V8与学生更正版V9，分开保存；V9保留V8前缀并追加清楚的覆盖性纠正，不重绑原正文来源。

素材、原话、画像、反馈均为合成练习，没有真人访谈/用户测试/教师点评。语音录音、课堂规模、真人教学质量仍未验；人工结果与签字保持空白。轮流表达是教学活动，不是新增轮值产品能力。本轮未部署生产、未改权限/角色或余额。

## QA代码与离线检查

[10项定向单元](./final-unit.txt)、[scoped TypeScript退出0](./final-types.txt)、[ESLint退出0](./final-lint.txt)、[6537条testid门退出0](./final-testid.txt)。旧入口准备的[9项记录](./entry-machine.json)保留，不倒写成当时已运行模型。真实付费lane显式opt-in，默认fullstack精确忽略新的continuation spec，不将未运行/skip算通过。

原生Chat复用WorkSpaceX现有UI，付费case无模型route拦截/fixture补绿；本机TLS/SDK canned对照是另一独立零费用机制实验，不能拿它证明本轮原S2底层根因。
