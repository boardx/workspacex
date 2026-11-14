# AIDT 状态与域边界隔离

本组修复均为前端 AIDT 模块内边界，没有新增 API、数据库、共享保存或权限契约。未提交；由根 agent 统一整合。

已验证的问题与改动：

- 资源关联缓存原先仅以项目、工具和资源为 key。同一项目 ID 下切换组织、用户或会话 token 后，旧的 allowed 可继续挂载原生编辑器。现在资源 scope 包含 org、user、project、token、tool、resource 和写权限；当前 scope 未核验时不挂载旧编辑器。
- 同组切换成员时，本页表单已经隔离，但原生 Chat 的 React key 缺 actor，可能保留前一成员的子组件状态。现在 Chat、转录、证据与资源子工作区均按 actor scope remount；AI 辅助面板也按 actor scope 开关。
- 页面输入回调原先只核对组织/用户/项目，没有核对最新只读权限。延迟 FileReader 完成时，可在只读降级后继续改本页草稿。现在阶段、报告、对照记录回调都同时核对最新写权限。
- 同一学生仅 token 刷新时，保留其本页草稿；资源权限重新读取。切换组织、用户或小组时不显示别人的草稿。
- 未获得完整身份时，不读取和挂载选中的原生资源编辑器。没有用客户端缓存推断服务器授权。
- `isAidtProject` 保持纯标签分类；`projectWorkspaceHref` 只有统一开关 `NEXT_PUBLIC_ENABLE_AIDT=true/1` 才路由至 AIDT。关闭时仍走普通 `/projects/:id`，没有修改既有 ProjectKind 或项目角色。

验证命令（Node22、pnpm9.15）：

```bash
pnpm --filter web test tests/aidt-state-isolation.test.ts tests/ui/aidt-state-isolation.test.tsx tests/ui/project-aidt.test.tsx
pnpm --filter web exec eslint components/project/project-aidt.tsx lib/project-aidt.ts lib/aidt-state-scope.ts tests/aidt-state-isolation.test.ts tests/ui/aidt-state-isolation.test.tsx
```

结果：22/22 用例通过，lint 退出0。`state-tests.txt` 与 `state-lint.txt` 为原文。

负向对照：临时载入基线 `9891da981` 的旧 `ProjectAidt`（仅把相对 import 改为等价的项目路径，以便夹具解析）。相同七个 UI 用例逐例重置 mock 后运行，5失败、2通过，且失败分别指出 actor remount、身份重读、迟到回执、token重读、只读后回调。完整输出为 `state-negative-control.txt`。临时夹具和临时测试已移除。先前一次 /tmp 依赖解析失败没有计入负向行为验证。

全量 web typecheck 在其它子任务并行修改期间退出2，报回归 agent 新测试使用未支持的 matcher；没有宣称全量通过。根 agent 整合并搬模块目录后需统一重新运行一次全量 typecheck 与回归。


## 整合审阅补充：A → B → A 生命周期

根 agent 指出 scope 字符串可能复用，已用真实 FileReader 单测验证。修复前：A 开始本地图片读取 → 切为 B → 返回 A → A 重填同默认 ID 的候选 → 完成旧 A 回调，旧图片确实写入新 A 候选。`state-aba-before.txt` 记录 1 失败、7 通过，失败节点含实际旧图 src；不是假设或仅源码断言。

修复：ProjectAidt 维护仅在组织/用户/小组 scope 变化时递增的生命周期 generation。阶段更新、报告更新、对照保留和带入 Chat 的旧回调均校验捕获 generation；原 actor 离开再回来时，旧回调不能重新匹配。AI 面板开关也绑定生命周期，A回来时不自动恢复旧面板。相同 actor 的 token 刷新不改变 generation，因此草稿及仍有效的本地读取可以保留，资源权限仍按 token 单独重读。

修复后：同命令针对性测试 24/24 通过，包含 A→B→A 旧图拒绝，以及同 actor token 刷新后本地图与文字均保留。`state-aba-after.txt` 为原文。相关两文件 lint 退出0，`state-aba-lint.txt` 为空错误输出。未启动新的全量 tsc，整合后的统一类型检查由根 agent 执行。
