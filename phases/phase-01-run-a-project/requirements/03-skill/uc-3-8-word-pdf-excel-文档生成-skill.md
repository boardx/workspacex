# 原始需求（细化）— UC-3.8 Word/PDF/Excel 文档生成 Skill（原创 Node 实现）

> 所属：阶段一 · 能跑完一场项目 / M3 上传 Skill（`skill-sandbox-execution` 首个切片的
> 后续切片，同一能力域的自然延伸，不是新开一条 UC 线）。
> 来源：人类 2026-08-27 直接要求"研究 GitHub 上 Claude Code 的开源 Word/PDF/Excel
> skill，按现有后台 skill 管理规则导入"；调研 + 授权结论 + 人类 2026-08-27 签核见
> `phases/phase-01-run-a-project/design-deltas/skill-office-docs-node-runtime/`
> （`contract.md`/`design-signoff.md`/`verification.md`，本文不重复展开，只做
> 承接 feature_list.json 生成的最小锚点）。

> **[人类已拍板 2026-08-27]**：不引入 Anthropic 官方 `anthropics/skills` 仓库或任何
> 社区 fork 的代码/提示词原文（该仓库 docx/pdf/xlsx 子目录是限制性许可，禁止复制/
> 衍生/再分发）。改为用开源 Node 库（`docx`/`exceljs`/`pdf-lib`，各自独立 MIT 许可）
> 原创实现三个"从零创建"skill，机制上完全复用 `skill-sandbox-execution`（F962）已验证
> 过的两层隔离、失败码、重试循环、产物落地路径——不重新设计这些机制。

## R1 概览

- **Use Case ID / 名称**：UC-3.8 / Word/PDF/Excel 文档生成 Skill
- **Actor**：能力维护者（导入并送审三个新 skill）、审核人（方法论审核，≠ 提交人）、
  chat 用户（挂载 skill 后在对话里请求生成文档）
- **目标**：组织成员在 chat 里挂载 `docx-create`/`xlsx-create`/`pdf-create` 三个新
  skill 之一并提出需求后，模型写出对应的 Node 脚本（`docx`/`exceljs`/`pdf-lib`），
  脚本在既有沙箱（`network:none` 容器 + Node 权限模型两层隔离，与 pptx skill 同一套
  边界）里真实执行，产出一个可下载的真实文件（.docx/.xlsx/.pdf），作为聊天附件出现。
- **本用例结果**：Skill 库中新增三条处于 `已启用` 状态的 skill（各自独立版本/审核
  记录），可被挂载到对话；`apps/skill-sandbox` 镜像预装 `docx`/`exceljs`/`pdf-lib`
  三个库。
- **系统边界**：与 UC-3.1（skill 契约 + 双重门禁）、F962（沙箱执行 + 隔离边界 +
  失败码 + 重试）完全共用同一套系统边界，本用例只新增三条 skill 声明与三个预装
  依赖，不新增任何边界组件。

## R2 前置条件 / 触发条件

- **前置条件**：`skill-sandbox-execution`（F962）已落地且沙箱服务可用（本用例的
  三个新 skill 走同一条 chat 触发→沙箱执行→产物落地链路，不新建第二条）。
- **触发条件**：能力维护者通过既有 **starter-pack 导入**路径（`importSkillStarterPack`）
  提交三份 `DeclarativeContract` 声明（手建入口 `POST /skills` 已冻结 410，本用例
  不重开）。

## R3 主成功场景（对齐 F962 的验收形状，三个 skill 各一遍）

1. 能力维护者导入 `docx-create`/`xlsx-create`/`pdf-create` 三份 skill 声明，各自
   经安全扫描 + 方法论审核（提交人 ≠ 审核人）后进入 `已启用`。
2. chat 用户挂载其中一个 skill 到当前对话，提出一句自然语言需求（如"帮我生成一份
   项目周报 Word 文档，包含这几个要点……"）。
3. 模型按 promptTemplate 指引写出对应 Node 脚本（`docx`/`exceljs`/`pdf-lib` 三选一，
   库已预装，脚本不 `npm install`），脚本在沙箱（`network:none` 容器 + Node 权限
   模型两层隔离）中执行。
4. 执行成功 ⇒ 产物经 `ObjectStore.putOnce` 落地，作为聊天附件出现，用户下载后能被
   对应软件（Word/Excel/PDF 阅读器）正常打开，内容与需求逐条对应。
5. 执行失败（非零退出）⇒ 真实 `exitCode`/`stderr` 回喂模型重写，上限 3 次；用尽仍
   失败 ⇒ `SCRIPT_FAILED_AFTER_RETRIES`，原样带回最后一次真实 stderr。

## R4 备选/异常路径

- 沙箱不可达 ⇒ `SANDBOX_UNAVAILABLE`（与 F962 同一失败码，不新增）。
- 脚本死循环/超硬超时 ⇒ `SANDBOX_TIMEOUT`，容器被回收（与 F962 同一失败码）。
- 脚本试图联网 ⇒ 必须失败（`network:none` 边界，与 F962 同一隔离机制，非本用例
  新增）。
- 用户要求"编辑一份已有的 docx/xlsx/pdf" ⇒ **不支持**，如实告知这是范围外能力
  （design-delta §2 明确排除，不做"看起来能做、点了才失败"的假入口）。

## R5 明确不做（承接 design-delta §2/§7，不在此重复推导）

- 编辑存量文件、格式转换、Word 修订记录/Excel 图表与公式求值/PDF 表单与 OCR、
  任何非 Node 运行时（Python/LibreOffice）。
