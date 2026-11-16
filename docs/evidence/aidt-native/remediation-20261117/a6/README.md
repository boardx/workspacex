# A6：本轮原生 E2E 与内容验收

状态：QA 实现与无模型检查已进行；真实浏览器和收费模型尚未获本轮 GO，以下不是通过回执。

旧记录 `completion-20261116/a6/fresh-journey-20261117` 和已有账本保持原样。旧结果是七任务六次成功、S5 取消；人工继续不构成完整主链通过。

## 本轮入口与顺序

- 主入口：`apps/web/e2e/aidt-v2-completion.spec.ts`，按 `S1 → S2 → S3 → S4 → S5 → Design V1 → S6 → 学生选择回5/Design V2/版本绑定 → SUM` 单独授权执行。
- 配置：`playwright.aidt-v2.config.ts`，单 worker、零重试，不启动服务器。
- 严格标记：`AIDT_V2_REMEDIATION=native-seven-no-bridge-20261117`；同时保留 fresh journey 标记及新 namespace 的独立账本和状态文件。不能复用、清空历史账本。
- S1–SUM 仍为同一组、同一真实 actor、精确保存版本，沿用原生 Chat 与正常成果保存、下载和重新登录验证。
- S5 必须为真实 Agent 成功后学生审阅，严格模式禁止人工桥接。原生 Design 使用其独立的已有用例，不把阶段 Chat 问答当作原型生成成功。
- SUM 前须已有真实保存 V1、V2、旧回第二步及当前回第五步的学生反思；这是报告内容判据的场景准备，不由报告模型凭空补造。

## 内容判据与人工边界

`aidt-v2-remediation-criteria.ts` 是独立、有限的自动回归门槛：

1. 各阶段实际回复必须提出一个有实质内容、符合当前阶段的学生问题；单问号不通过。
2. S2 不得建议模拟替代真实采访；清楚的“模拟不能替代真实访谈”允许通过。
3. S3 不得填造无来源年龄等资料，不能要求编造意外发现；“暂无”可继续。
4. 所有合成夹具不得变为已证实用户事实；Agent 不得自行确认或保存阶段成果。
5. SUM 必须呈现问题来源、意外发现/暂无、画像/HMW、学生分类、验证问题与学习、真实研究及教师点评缺失。
6. 已保存可见 V2 及历史/当前回溯决定分别检查；截断或节选必须披露。不能以保存、导出成功代替模型内容通过。
7. S6 通用合成反馈文件明确不是该原型版本实测；不使用模板号码映射冒充实际用户记录。

上述检查不能证明真实课堂教学效果、采访有效性、真实多人协作质量或普通学生模型消费权限。每份结果保留 `humanTeachingReview: required`。本轮仍使用合成教学材料，真人访谈与录音后置。

## 正常 HITL，不重发

启用本轮 `AIDT_V2_PLAN_REVIEW_DIR` 后，首次实际 `write_todos` 会把完整参数和 canonical SHA256 写到 `<runId>.pending.json`。测试等待最多180秒，root 审核后创建 `<runId>.approved.json`。证明须精确匹配 project/thread/run/permission/tool/digest，`reviewedFullArgs:true`、`reviewedBy:"root"`、`decision:"once"`。驱动核对正常 UI 的完整参数并点“仅本次允许”。无证明、参数变化、第二个新权限请求均停止；不发送新学生消息、不新建模型预约。旧失败仍保留。

## 已执行无模型检查

- QA 单测：4 文件、15 用例通过（加入单问题门槛后将复查）。
- 改动文件 ESLint：0 warnings/errors。
- Playwright `--list`：主链7用例发现成功，未启动浏览器或模型。
- Web TypeScript：执行中，实际结果另记。
