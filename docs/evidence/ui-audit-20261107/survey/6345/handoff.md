# #6345 复制草稿保留项目

人类直接交办两轮浏览器审计修复；队列外原因与计划已写GitHub issue。

## 根因与修复
复制回调既不关联project resource也不保留projectId路由。增加关联调用并在失败重试时复用createdId。

## 精确文件清单
- `apps/web/components/survey/live/survey-draft-copy.tsx`
- `apps/web/components/survey/live/survey-workspace.tsx (仅SurveyDraftCopy回调hunk)`
- `apps/web/tests/ui/survey-draft-copy.test.tsx`

## 验证
- `6345-red.log`
- `6345-green.log`

真实Chrome由主会话统一复测，本任务未宣称线上成功。未操作commit/push/merge。

## 交付限制
证据目录被gitignore，主会话提交需要显式force添加。PR目标develop，保持一个issue一个PR。

## 实际命令结果
```text
pnpm --filter web exec vitest run tests/ui/survey-draft-copy.test.tsx → 4 passed（含关联失败重试）
pnpm --filter web typecheck → exit 0
定向eslint --max-warnings 0 → exit 0
git diff --check → exit 0
```
