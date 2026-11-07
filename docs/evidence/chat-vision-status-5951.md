# #5951 — 图片附件解析失败的浏览器断言修复

2026-10-27，基于 `origin/develop@35e71c4e5243574ed1b264f8d13daf679f75db5c`，复用 e435。

## 原始失败

run 40485490214 / job 122126114502 的 `chat-read` 最终结果：126 passed、5 skipped、1 failed。唯一失败为 `chat-attachment-image-vision-extraction.spec.ts:107`：

```text
Expected substring: 已就绪
Received string: chat-read-e2e-vision-p1.png70 B已上传附件已上传，但内容解析失败，请联系管理员。
Timeout: 30000ms
```

现行 `ChatComposerAttachments` 只有 `extractionStatus === extracted` 才标“已就绪”；其它上传成功状态显示“已上传”，`AttachmentExtractionNotice` 明确显示解析失败。此测试覆盖的是 loopback 视觉端口返回 InvalidApiKey 的失败降级路径，旧“已就绪”断言和“HTTP 不暴露解析状态”的头注已经过时。

## 修复及强度

只改该 e2e spec：要求上传状态 uploaded，明确显示“已上传”及“附件已上传，但内容解析失败，请联系管理员。”，反向禁止“已就绪/已提取/已识别”。保留真实 multipart 201、发送请求含附件 id、模型原样回显解析失败提示、刷新后附件/回复落库、run succeeded 的全部原有断言。更新过时头注，不改产品或服务端代码。

## 本轮验证

- `next lint --max-warnings 0 --file e2e/chat-attachment-image-vision-extraction.spec.ts`：exit 0。
- `pnpm --filter web typecheck`：exit 0。
- 真实隔离浏览器：1 passed（测试执行29.2s），1 原有 fixme skipped；含启动/收尾总计3m16s，清理2s，exit 0。
- `git diff --check`：exit 0。

前两次使用标准启动命令时 Docker 构建超过 webServer 120 秒启动上限，均为零测试执行，不记为 PASS。最终使用隔离外壳分配的独占 project `wsx-dcd061a8517b40083979`，从本机已有的标准 PostgreSQL/AGE 镜像启动新 postgres/redis（`up --no-build`），再走 config 已支持的 `WORKSPACEX_REUSE_INFRA=1` 路径，复用的仅为本次自建的新栈。API、迁移、种子、上传、视觉失败替身、模型链路与浏览器仍是真实标准链路，无 HTTP 拦截。外壳结束时释放自有栈，未触碰共享数据库或其它会话栈。

完整 chat-read 车道未在本地重复执行；原 CI 的其它126条通过不能冒称是新 SHA 的全量结论。本修复与颜色基线 #5948 / PR #5950 独立；完整 base 仍需先集成 #5950，不能仅据此测试通过宣布原 workflow 全绿。
