---
bundle: chat-file-upload
phase: "01"
covers: []   # F 编号待 requirement-author 把 V9 拆进 feature_list 后回填；本束先行签核设计方向与参数
status: confirmed           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by: yanbin shen
confirmed_at: 2026-08-11T14:32:00+08:00
confirmed_via: >-
  人类在 2026-08-11 的「Chat UI 体验迭代」会话里，看过 docs/proposals/PROP-CHAT-FILE-UPLOAD-001.md
  后逐字回复「我看了，并且approve」；随后对该会话给出的一组推荐默认值逐字回复「yes to all」。
  由 coord-main 按 #660（agent-instructions 束）先例代抄进本 frontmatter；人类可随时修改。
---

# 契约束 `chat-file-upload` 设计签核（V9 文件上传）

> 签核对象：`docs/proposals/PROP-CHAT-FILE-UPLOAD-001.md` 的设计方向 + 下列人类确认参数。
> 三件套材料（① UI ② 用例 ③ API 契约）由 dev-chat-e2e 随后补入本束目录，
> 应逐条与本文参数一致——不一致以本文（人类确认值）为准。

## 人类确认的参数（2026-08-11「yes to all」，逐字裁决的展开）

| 项 | 确认值 |
|---|---|
| 单文件大小上限 | **25 MB** |
| MIME 白名单 | **PDF / text·markdown / 图片(png·jpg·webp) / Office(docx·xlsx·pptx) / csv**（保守起步） |
| 每消息附件数上限 | **10** |
| 保留策略 | **随线程删除**（无独立生命周期） |
| 分期 | **是**：V9-a（上传+存储+预览）先行；V9-b（文件内容进模型）随 context engine L3 检索层 |
| 数据模型 | 新表 `chat_message_attachments`（PROP §2.1 列定义） |
| 上传端点 | `POST /chat/threads/:threadId/attachments`（multipart），权限复用线程写能力 |

## 范围边界
- V9-a 不含「文件内容进模型」——那是 V9-b，依赖 chat-context-engine 束的 L3 层
- 上传物走服务端存储，前端不做本地假预览充当上传成功（本仓「无真实数据支撑不做假 UI」硬规矩）
