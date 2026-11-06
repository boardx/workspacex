# #6351 白板编辑器内重命名

人类直接交办两轮浏览器审计修复；队列外原因与计划已写GitHub issue。

## 根因与修复
LiveBoard未接onTitleChange，标题菜单只有返回列表提示。复用updateBoard，输入失焦或Enter提交，错误保留原服务端名称。

## 精确文件清单
- `apps/web/components/whiteboard/live-board.tsx`
- `apps/web/components/whiteboard/board-editor-header.tsx`
- `apps/web/tests/whiteboard/live-board-collaboration-status.test.tsx`

## 验证
- `6351-red.log`
- `6351-green.log`

真实Chrome由主会话统一复测，本任务未宣称线上成功。未操作commit/push/merge。

## 交付限制
证据目录被gitignore，主会话提交需要显式force添加。PR目标develop，保持一个issue一个PR。

## 实际命令结果
```text
pnpm --filter web exec vitest run tests/whiteboard/live-board-collaboration-status.test.tsx tests/ui/board-header-responsive.test.tsx → 14 passed
pnpm --filter web typecheck → exit 0
定向eslint --max-warnings 0 → exit 0
git diff --check → exit 0
```

## 主会话review后的返工
新增文件：`apps/web/tests/ui/board-header-rename.test.tsx`。真实Header Escape+blur回归原先通过，pending输入锁定回归原先失败。修复后16 tests passed（Header重命名2+响应式3+LiveBoard11）。Header会await实际请求，在pending期间禁用输入，失败恢复可编辑；LiveBoard直接返回renameBoard Promise。Escape带取消标识阻止紧随blur。证据 header-red.log / header-green.log / header-lint.log。此为实现者返工，不是对自己代码的独立review。
