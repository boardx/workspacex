# 模型失败后的草稿保留：零费用复核

本轮未启动浏览器、服务或模型，未发送外部网络请求，未改权限、资金、历史M24或人工PDF。以下是现有真实React/SDK组件的受控离线测试，不能冒充本次S2模型重跑。

## 实际缺陷及最小修复

学生发送A失败后，在原生输入框写未发送B，再点失败横幅或执行时间线的重试A，旧sender无条件清空composer，B丢失。原生Host测试先复现AIDT两个入口及普通Chat两个入口，4 failed / 5 passed；失败均为B预期非空、实际空串。先前临时反例也通过实际CopilotKit错误总线发出MODEL_CALL_FAILED再重试，复现同样丢失，不仅是一个抛异常的单元mock。

修复仅增加内部`send`选项`retry`，两个现有重试入口显式传true，清composer正文、活跃mention与待发附件时排除该模式。它不会进入SDK forwardedProps或HTTP；首次新发送继续清稿，原lastSent原文、clientMessageId、附件和冻结selector逻辑不变。没有重做Chat UI，也没有自动再发。

root交叉审阅进一步指出：仅保留B正文仍会清B的活跃mention，且A原来带附件时重试会清空B的新待发附件。沿现有uploadAttachment网络边界fixture，通过真实文件input/上传hook先证两个入口的B附件列表和@候选都消失（2 failed / 9 passed）；修复后A仍只重发旧attachmentIds，B新附件/mention保留，随后学生正常发送B使用新clientMessageId与B附件且照常清理composer。首次QA曾错误等待空正文send enabled，在任何发送前失败；已保留该准备红并只将填写A移到enabled等待前，不当成业务缺陷。

生产触点：`apps/web/components/chat/copilotkit-v2-panel-body.tsx`（内部选项与清稿guard，1952行）、`apps/web/components/chat/copilotkit-v2-panel-view.tsx`（两个重试入口）。回归：`apps/web/tests/ui/copilotkit-v2-host-run-context.test.tsx`。

## 定向证据

在`apps/web`，Node22 / pnpm9：

```sh
pnpm exec vitest run tests/ui/copilotkit-v2-host-run-context.test.tsx --maxWorkers=1 --minWorkers=1 --no-cache
pnpm exec vitest run tests/ui/copilotkit-v2-host-run-context.test.tsx tests/ui/workbench-composer-draft.test.tsx tests/ui/aidt-run-context-receipt.test.tsx --maxWorkers=1 --minWorkers=1 --no-cache
pnpm exec vitest run tests/ui/copilotkit-v2-host-run-context.test.tsx tests/ui/workbench-composer-draft.test.tsx tests/ui/aidt-run-context-receipt.test.tsx tests/ui/copilotkit-v2-sent-attachment-on-message.test.tsx --maxWorkers=1 --minWorkers=1 --no-cache
pnpm exec eslint components/chat/copilotkit-v2-panel-body.tsx components/chat/copilotkit-v2-panel-view.tsx tests/ui/copilotkit-v2-host-run-context.test.tsx
```

- [修复前真实失败](retry-draft-before-red.txt)：4 failed / 5 passed，四个重试入口均只在B清空断言失败；两个普通入口分别执行。
- [修复后](retry-draft-after-green.txt)：3文件22 passed（9+6+7），退出0。包含两个AIDT冻结重试入口、两个普通原生重试入口、首次正常清稿、更新来源仅影响新发送、busy/unready不清稿、不排队、真实canonical run绑定及普通Chat零额外host读；草稿作用域隔离与回执失败/超时可读重试一起通过。
- [新增附件/mention业务红](retry-attachment-before-red.txt)：两个入口各自同时丢失B附件与活跃mention；[先前QA准备红](retry-attachment-qa-precondition-red.txt)独立保留，不混为业务红。
- [最终受影响回归](retry-final-regression-green.txt)：4文件25 passed（11+6+7+1），退出0；含原来“首次发送附件立即从composer移到human消息”的回归。
- [进一步验证B实际可发送](retry-attachment-final-green.txt)：修改测试后只重跑受影响host文件，11 passed，B真实forwardedProps附件是new-B且client为新值，初次发送清稿/队列仍成立。
- [最终ESLint](retry-final-eslint.txt)：3文件退出0。`git diff --check`退出0。

## 其余体验的证据边界

AIDT父`project-aidt.tsx`的本页draft/共享保存controller与native Chat分开，Chat仅上报真实线程，不把模型错误或acceptedRun当作阶段完成/小组保存；导航仍为学生Link操作。`use-aidt-shared-stages.ts`只有显式保存动作写入，原生错误不会触发该保存。发送成功受理的原话是human消息及lastSent，不能把已发A应自动回填composer与未发B保留混为一谈。

`aidt-run-context-receipt.tsx`保留来源版本并区分准备/组装/派发，明确派发不代表模型判断正确或小组确认；读取失败去除不可核实正文并可刷新，展开有界轮询。成员文字launcher挂于全局providers；频道草稿按org/user/project及话题独立保存，约5秒拉取，与native Agent错误状态无数据连接。两者都不会自动成为阶段成果。本轮没有重复原成员文字60项/原件52项整套验证，也未新增成员文字或阶段保存成功声明。

本次实际S2补测仍以M24独立失败证据为准：无assistant、无失败后的学生修订保存及fresh login成功，不能据上述受控测试声称这些浏览器步骤已经完成。2笔pending占款未因修复而清除或重置，额度耗尽，不进行真实重试。

人工H12后续可补最小失败分支（本文件仅建议，不改冻结主手册）：在获准的任务发生真实失败后，写B，再从横幅/时间线重试原A；核B仍在、A的client/来源未变、小组保存版本与当前阶段未变、成员讨论仍可进入；检查重试确有授权额度。额度不足时只核失败状态与草稿，不点重试。另核刷新回执不会发模型、不能把派发当成功。本轮尚未执行此新增浏览器分支。
