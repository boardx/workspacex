# 问卷题型与模板验收（issue #3760）

用户确认设计后实现。基线 `278e210831de605fb93a73bce8ed92b4ab66a47e`；实际提交 SHA 由 PR commit 记录。本地独立 PostgreSQL/Redis、真实 API 与 Chromium，无生产数据修改。

## 已执行验证

- `./init.sh`：默认快速初始化通过（不是全仓测试）。
- `pnpm --filter @repo/contracts exec vitest run`：全 80 文件通过；本次相关 33 条契约测试覆盖 29 种答案形式、校验、显隐、统计与兼容。
- `pnpm --filter web exec vitest run tests/ui/survey`：21 文件 / 211 条通过。
- `source /tmp/survey-types-env.sh; pnpm --filter @repo/api exec vitest run tests/survey`：7 文件 / 56 条通过，包含真实 PostgreSQL/HTTP/对象字节的附件权限、认领回滚、幂等、PNG 和清理。
- 同环境 `tests/kernel/permission-propagation-six-paths.test.ts`：30 条通过（新增明确权限边界说明和对应预算）。
- contracts、API、web typecheck 及 lint 通过；`git diff --check` 通过。
- `apps/web/scripts/survey/question-types-check.cjs`：真实浏览器逐题填写全部 29 种答题形式，分页/手机矩阵/排序键盘拖动，公开提交后通过 owner API 读取全部答案；TXT 下载字节一致，PNG 签名真实上传下载。结果见 `result.json`，页面截图见同目录。
- `apps/web/scripts/survey/builtin-templates-check.cjs`：12 个问卷资源（6 套完整问卷 + 6 个模块）和 6 套报告模板；复制/编辑/保存/刷新后原始模板不变，真实发布/匿名答卷/生成报告，下载 Word 和 PDF 打印内容仅包含报告。
- Word 下载 ZIP 的 `word/document.xml` 独立检查含实际答卷“企业高管”，不含“设计问卷”“问卷列表”。报告组件测试另外验证结构化回答、完整章节、图注、分页和失败图片不伪报导出成功。

## 独立审查与修复

5 项发现均修复并补回归：删除问卷后的附件清理；普通合法 PNG 兼容；其他选项改选后清空隐藏说明；星级评分按步长生成；随机选项跨页顺序稳定。真实浏览器另外发现并修复分页按钮转为提交按钮时的提前提交，以及手机签名画布比例。

## 全仓检查边界

`pnpm verify:quick` 的 typecheck/lint 通过，但全仓 web 测试首轮 4 条失败（4241 passed，5 skipped）；API 全量 lane 随 turbo 失败停止。三条非问卷异步 UI 用例独立复测通过。剩余 `tests/ui/recording-file-client.test.tsx` 的 WebCrypto/ArrayBuffer 错误，在干净的基线 detached worktree（同 SHA，独立依赖）同样复现：1 failed / 2 passed。该录音问题不是此次引入，未扩大本 PR 修改范围，不能称全仓全绿。相关原始本地日志：`/tmp/survey-types-quick.log`、`/tmp/survey-unrelated-recheck.log`、`/tmp/survey-baseline-recording.log`。临时基线 worktree 已删除。

## 数据与运行限制

文件格式与 8 MiB/10 件限制由共享契约定义；附件和签名只在答卷详情通过鉴权下载，报告只输出数量，不泄露对象路径。已发布题目仍锁定；新增保存的完整模板不包含模拟答卷或预设结论。生产部署、PR 检查与资源释放情况见本目录 session-handoff.md。
