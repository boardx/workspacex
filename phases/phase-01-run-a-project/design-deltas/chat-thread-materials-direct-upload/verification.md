# 验收口径 · chat-thread-materials-direct-upload

每条都要有反证（先证明缺陷存在 / 修法删掉即红），否定断言配正面用例。

1. **两个入口不混**（界面单测 + 真栈 e2e）：材料页签上传后 composer 附件区为空、composer 待发计数为 0；材料列表立即出现该文件，来源「直接上传」。配对：composer 附件入口上传的文件仍出现在 composer，发送后出现在材料列表，来源「随消息」。
2. **T2**（真库）：先直传一份线程材料，再发一条不带附件的消息——该材料 `message_id` 仍为 NULL、`scope='thread'`。
3. **T3**（真库）：线程已有 10 份线程材料时，composer 仍能挂满每条消息上限的附件。
4. **上限**：第 51 份线程材料 ⇒ `ATTACHMENT_LIMIT_EXCEEDED`；单文件超限 / MIME 不在白名单沿用既有错误码。
5. **删除**：直传材料可删（行消失、列表消失）；随消息附件请求删除 ⇒ `MATERIAL_NOT_DELETABLE` 且行仍在；他人线程 ⇒ `MATERIAL_NOT_FOUND`/`THREAD_NOT_VISIBLE`（RLS 反证）。
6. **Agent 可见**（真栈 + 真实模型，一次）：材料页签直传一份含唯一标记词的文件，随后发「根据材料回答：标记词是什么」，回答含该标记词；run 输入清单含该文件。配对：删除后再问，清单不含该文件。
7. 契约门：`lint-contract-route-coverage --strict`、`lint-contract-source` 绿；新增常量只在契约里声明一次。
