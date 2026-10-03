# 2026-10-04 问卷真实 UI 验收库存

代码基准：`814dc05a36e1f2645b7528b9dacc0a344ec615ae`。本清单是新的静态库存，不是执行证据。所有行 `NOT_STARTED`，没有继承任何旧 PASS。

## 旧清单恢复边界

已用 rg 搜索仓内 CSV 文件名、docs/phases/.harness 的 #5051/305/285 PASS 痕迹；没有找到原305行CSV。旧 `/private/tmp/pr5017-remaining` 不存在，不能还原旧行ID。`legacy_id` 留空，使用 `SV26-*` 新ID。数量来自当前分解粒度，不能用305作为覆盖证明或强制补齐数字。清单包括按钮、菜单、弹窗、输入及时间/权限反证，行数不等于界面按钮个数。

## 当前代码范围

可达入口：`/studio/survey` 使用 LiveSurveyLibrary；modules/question-templates 和 reports/templates tab 使用 SurveyTemplateLibrary。对象设计/发布/答卷/模板/报告路由使用 LiveSurveyWorkspace；公开 token 路由使用 PublicSurveyForm；两个模板对象路由使用 SurveyTemplateWorkspace。AI 创建另有 `/studio/survey/new/import`。

`resource-library/*`、旧 workflow/*、旧 survey-workspace/survey-list/template-editor-shell 等静态原型不在上述当前 route import 图内，没有把它们的死按钮混入可点击库存。若项目入口运行时仍能到达这些组件，应另留路由证据再扩充。

类型枚举有31种，库存为每型拆出新增、切换、设置保存和真实试填/公开填写；description/page_break 验证呈现与分页，不伪造答案。共用选项、图片、矩阵、字段、数字、上传、条件/跳转控件另列。`22-source-labelled-controls` 是源码静态 aria-label 补充项，需依据 source 行和真实场景定位；容器/region 标签没有当成按钮。

自动设计检查已在 main，包含即时具体诊断、修复定位和服务器422拒绝。#5192 起止时间预约及 #5193 解绑尚未在本 main：对应20行 `MAIN_MISSING`，都是 NOT_STARTED，引用此前功能分支 SHA 仅供集成定位，不能凭旧验收转 PASS。当前 main 只有截止时间，未提供 startsAt 输入；当前 template-actions 未提供解绑按钮。

Source-policy：当前 survey AI-proposal 仅需求/文件/已保存录音来源，没有可达的 sourcePolicy 开关。不得把 research 的来源策略签核假定为 survey 能力。来源身份显示与真实模型链路需在 AI 导入批次保存证据。匿名 #5067 的活 issue/人类授权由父 agent 独立读取，库存 `PARENT_VERIFY_5067` 两项不推断已签核。

## 执行和证据规则

按 batch 顺序执行。先用专用合成问卷和个人模板；为全部31型准备合法配置，为题目顺序/跳转准备至少三题，为报告准备包括有效/待复核/排除、分组和数值的合成答卷。首个 UI 操作前核对实际 runtime/build SHA；不同分支证据不得混称 main。

每行填写真实 route、控件状态、执行前置、动作和可见结果；保存操作须刷新读回，公开提交须后台确认同题同值，导出须读实际下载文件而非只检查点击成功。需要失败场景的行使用可控故障并披露机制，不能拿 API seed 冒充 UI 创建。动态重复实例（每个选项/每份答卷）按同语义去重；不同题型、状态、入口/菜单位置的行为保留独立行。

CSV字段：id/legacy_id/batch/route/precondition/control/expected/status/scope/boundary/source/source_sha/evidence。`source_sha` 是库存基准，不是执行时构建证明。MAIN_MISSING 的 source feature SHA 不代表已进入 main。{surveyId}/{token}/{templateId} 用自有样本替换；竖线括号表示需选实际子路由。

- 二维码明确排除，scope=EXCLUDED，仍保持 NOT_STARTED，执行汇总单列排除，不计PASS。
- 删除问卷、删除个人模板的最终永久确认行：NEEDS_ACTION_TIME_CONFIRMATION。菜单和取消可先测，最终确认前当场明确对象，不因旧许可推定新许可。
- PDF原生对话框：NATIVE_PDF_HANDOFF，交接人类；按钮点击不等于PDF导出可读。
- 未发布/已发布/关闭/历史批次/ready clean与dirty、边界disabled均需独立状态证据；不能把一个正常样本认证全部状态。

这两个文件由独立库存 reviewer 负责；未修改Git、产品、运行时，没有创建worktree或loop。其他worker拥有 progress/结果/证据文件，库存不覆盖其执行结果。未提交任何远端评论或合并。
