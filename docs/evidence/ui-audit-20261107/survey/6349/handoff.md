# #6349 上传前展示文件类型

人类直接交办两轮浏览器审计修复；队列外原因与计划已写GitHub issue。

## 根因与修复
文件选择accept已限制格式，但没有任何文字提示。使用实际accept配置显示支持格式，避免副本漂移。

## 精确文件清单
- `apps/web/components/survey/live/question-material.tsx`
- `apps/web/lib/i18n/namespaces/survey-design.ts`
- `apps/web/tests/ui/survey-upload-hint.test.tsx`

## 验证
- `6349-red.log`
- `6349-green.log`

真实Chrome由主会话统一复测，本任务未宣称线上成功。未操作commit/push/merge。

## 交付限制
证据目录被gitignore，主会话提交需要显式force添加。PR目标develop，保持一个issue一个PR。

## 实际命令结果
```text
pnpm --filter web exec vitest run tests/ui/survey-upload-hint.test.tsx tests/ui/survey-question-controls-i18n.test.tsx → 42 passed
pnpm --filter web typecheck → exit 0
定向eslint --max-warnings 0 → exit 0
git diff --check → exit 0
```
