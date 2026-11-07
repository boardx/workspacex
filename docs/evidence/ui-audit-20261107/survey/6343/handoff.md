# #6343 后台回收状态与答卷刷新

人类直接交办两轮浏览器审计修复；队列外原因与计划已写GitHub issue。

## 根因与修复
初次加载后未重新读取远端答卷，返回窗口和切换答卷步骤沿用旧runtime。增加focus/visibility、15秒更新、进入responses刷新。已有边界定时器保持使用，补跨开始时间测试。

## 精确文件清单
- `apps/web/components/survey/live/survey-workspace.tsx (刷新effect，勿包含复制回调hunk)`
- `apps/web/tests/ui/survey-live-workspace.test.tsx`

## 验证
- `6343-red.log`
- `green.log`

真实Chrome由主会话统一复测，本任务未宣称线上成功。未操作commit/push/merge。

## 交付限制
证据目录被gitignore，主会话提交需要显式force添加。PR目标develop，保持一个issue一个PR。

## 实际命令结果
```text
pnpm --filter web exec vitest run tests/ui/survey-live-workspace.test.tsx tests/ui/survey-draft-copy.test.tsx → 42 passed（含开始边界）
pnpm --filter web typecheck → exit 0
定向eslint --max-warnings 0 → exit 0
git diff --check → exit 0
```
