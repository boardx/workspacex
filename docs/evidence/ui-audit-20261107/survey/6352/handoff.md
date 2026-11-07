# #6352 答卷Markdown附件清单

人类直接交办两轮浏览器审计修复；队列外原因与计划已写GitHub issue。

## 根因与修复
答卷只含附件UUID；新增owner授权metadata读路径，导出原文件名/类型/字节数/ID。没有新增公开地址或导出token。

## 精确文件清单
- `packages/contracts/src/survey.ts`
- `apps/api/src/application/survey/survey-attachment-service.ts`
- `apps/api/src/interface/controllers/survey-attachment.controller.ts`
- `apps/api/tests/survey/survey-attachment-metadata.test.ts`
- `apps/api/vitest.survey-attachment-metadata.config.ts`
- `apps/web/components/survey/live/response-list.tsx`
- `apps/web/lib/survey/response-markdown.ts`
- `apps/web/tests/ui/survey-response-export.test.ts`
- `apps/web/tests/ui/survey-response-review.test.tsx`

## 验证
- `6352-red.log`
- `6352-green.log`
- `6352-api-green.log`

真实Chrome由主会话统一复测，本任务未宣称线上成功。未操作commit/push/merge。

## 交付限制
证据目录被gitignore，主会话提交需要显式force添加。PR目标develop，保持一个issue一个PR。

## 实际命令结果
```text
pnpm --filter web exec vitest run tests/ui/survey-response-export.test.ts tests/ui/survey-response-review.test.tsx → 7 passed
pnpm --filter @repo/api exec vitest run --config vitest.survey-attachment-metadata.config.ts → 1 passed
pnpm --filter web typecheck → exit 0
定向eslint --max-warnings 0 → exit 0
git diff --check → exit 0
```

API typecheck (`pnpm --filter @repo/api typecheck`) → exit 0。
无本任务创建的Docker栈、worktree或后台服务需释放。

## CI返工
verify-affected复现既有双语Markdown导出用例失败：新异步附件清单未await，且无附件普通题干被额外转义，改变原canonical字节。用例等待实际异步导出；将escaping范围收窄到新增附件清单元数据，保留已有题干/ID字节。RED复现后，双语、答卷review与附件导出26/26通过。
