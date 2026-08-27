# contract · 新增 Word/PDF/Excel 文档生成 skill（原创 Node 实现，非 Anthropic 官方 skill 移植）

> 规范唯一来源。签核口径见同目录 `design-signoff.md`，验收口径见 `verification.md`。
> 触发缘由：人类 2026-08-27 要求"研究 GitHub 上 Claude Code 的开源 Word/PDF/Excel skill，
> 按现有后台 skill 管理规则导入"。调研结论见 §0——不能"导入"，只能原创重新实现。

## §0 前置调研结论（为什么标题里写"非移植"）

- Anthropic 官方 `anthropics/skills` 仓库的 `docx`/`pdf`/`xlsx`/`pptx` 四个子目录
  **source-available，非开源**：LICENSE 明确禁止复制、创建衍生作品、再分发；使用受
  Anthropic Consumer/Commercial Terms 约束，不是标准开源许可。
- 检索到的两个社区 fork（`appautomaton/document-SKILLs` 标 MIT、`tfriedel/claude-office-skills`
  未标许可证）均自称内容"直接来自"或"改编自"同一份受限源——第三方在自己不持有版权的
  内容上贴 MIT 标签，不产生 Anthropic 未曾授予的权利，法律上不构成一条干净的引入路径。
- 即使抛开授权问题，Anthropic 官方 skill 用的是 **Python**（python-docx / openpyxl /
  pdfplumber，部分操作还调 LibreOffice）；本仓沙箱是 **Node.js-only、`network: none`、
  运行时不能 `pip install`/`npm install`**（见 §3），架构上也接不上。
- **结论（人类 2026-08-27 已就此裁决，见 `design-signoff.md`）**：不碰 Anthropic 官方或
  社区 fork 的任何代码/提示词原文，用本条 delta 里列出的**开源 Node 库**（各自独立
  MIT/相容许可，非 Anthropic 出品）原创写三份新的 `DeclarativeContract`
  （promptTemplate 是我们自己的表述，不是翻译/摘抄 Anthropic 的 SKILL.md）。

## §1 问题陈述

现状：`已启用` 的 skill 目录里只有 pptx 一条"从零建 deck"的真执行路径
（`skill-sandbox-execution` delta，covers F962）。用户在 chat 里让 agent 产出
Word 文档、Excel 表格、PDF 文件时，没有对应 skill 可挂——要么被引导去手写脚本
硬凑（本仓已冻结手建 skill 入口，`createSkillDraft` 恒 410），要么模型只能吐文字
描述，产不出真实文件。这与 pptx 那条 delta 解决的是同一类缺口。

## §2 范围（首个切片，对齐 pptx delta 的"只做 Create"先例）

**做**：三个"从零创建"能力，都是纯 Node、都不需要读取/解析已存在的文件：
- **docx**：用 [`docx`](https://www.npmjs.com/package/docx)（MIT）从零拼一份
  `.docx`——标题、段落、列表、表格、基础样式。
- **xlsx**：用 [`exceljs`](https://www.npmjs.com/package/exceljs)（MIT）从零建一份
  `.xlsx`——多 sheet、单元格样式、基础公式（`SUM`/`AVERAGE` 等 exceljs 原生支持的
  公式写入，**不**做公式求值校验，求值交给打开文件的 Excel/LibreOffice）。
- **pdf**：用 [`pdf-lib`](https://www.npmjs.com/package/pdf-lib)（MIT）从零生成一份
  `.pdf`——文本排版、基础表格（手工画线/定位，pdf-lib 本身不带表格布局引擎）、
  内嵌图片。

**不做**（与 pptx delta §2 同一条纪律：这是范围声明，不是"做不到"）：
- 编辑/修改已存在的 docx/xlsx/pdf（需要解析并保留原有格式，是完全不同量级的工作，
  且 exceljs/docx/pdf-lib 对"读+改+存"这条路径的保真度各自有明显短板）。
- Word 修订记录（tracked changes）/批注。
- Excel 图表、数据透视表、公式**求值**（只写入公式文本，不校验结果）。
- PDF 表单域、OCR、已有 PDF 的合并/拆分/加水印。
- 任何需要 LibreOffice/Poppler 等非 Node 二进制运行时的操作。

依据：与 pptx delta 同一条理由——把"编辑存量文件"和"格式转换"一起做进首个切片
会让沙箱镜像和范围膨胀数倍，且它们都不是"能不能产出一个新文件"的必经路径。

## §3 沙箱镜像改动

复用现有 `apps/skill-sandbox` 服务与两层隔离（L1 容器 `network: none` + L2 Node
`--experimental-permission`），**不新增服务、不新增运行时类型**——三个库都是纯
JS/TS，跟 `pptxgenjs` 走同一条路：

1. `apps/skill-sandbox/package.json` 新增依赖：`docx`、`exceljs`、`pdf-lib`。
2. `Dockerfile` 的 `npm install --omit=dev` 一并装好这三个包，物化进
   `.sandbox-modules/node_modules`——沿用 pptxgenjs 已验证的"扁平真实目录树，不用
   pnpm 软链布局"（Node 权限模型不递归解析软链，见 `execute-script.ts` 头注）。
3. 新增启动自检：`node -e "require.resolve('docx'); require.resolve('exceljs'); require.resolve('pdf-lib')"`，
   与现有 pptxgenjs 自检同一形态。
4. `network: none` / 文件系统边界 / 单文件 32MB 上限 / outdir 单层不递归 —— 全部
   **原样复用**，本条 delta 不改隔离边界本身的任何一条规则。

⚠ 与 pptxgenjs 同一条纪律：三个 skill 的 promptTemplate 都要写清"库已预装，不要
在脚本里 `npm install`"——`network: none` 下装不出来，写了也只会先跑一次必然失败
的安装再报错，浪费一次重试配额。

## §4 skill 声明（三份新的 `DeclarativeContract`）

不新增字段、不改 `skills.ts` 里的实体形状——`promptTemplate`/`inputSchema`/
`outputSchema`/`dataScope`/`readsRawTranscript`/`fallbackDeclaration` 六个既有字段
足够描述这三个 skill，逐字沿用 pptx skill 已验证过的字段用法：

| skill | inputSchema 大意 | outputSchema 大意 |
|---|---|---|
| docx-create | 标题、正文段落数组（支持基础样式标记）、可选表格数据 | 产出文件引用（沿用 pptx 的 `ProducedFile` 附件通路） |
| xlsx-create | sheet 名、表头、行数据数组、可选公式字符串 | 同上 |
| pdf-create | 标题、正文段落数组、可选图片引用（需已在 dataScope 内可读） | 同上 |

`fallbackDeclaration`：三者一致——脚本执行失败达到重试上限（沿用 pptx 的 N=3）时，
如实回显最后一次 `stderr`，不糊成"生成失败请重试"（与 pptx delta §7 同一条纪律）。

`dataScope`：以提交人权限为上界，不读取超出当前对话可见范围的任何文件（同既有
skill 契约的既有约束，不新增/放宽）。

## §5 产物落地、失败码、重试循环

**全部原样复用 pptx delta 已签的机制，不重新设计**：
- 产物走 `ObjectStore.putOnce` → 聊天附件通路（`skill-sandbox-execution` §5）。
- 失败码复用既有 `SANDBOX_UNAVAILABLE`/`SANDBOX_TIMEOUT`/`SCRIPT_FAILED_AFTER_RETRIES`
  三个（`skill-sandbox-execution` §6.2），不新增第四个——三个库的失败模式（依赖缺失/
  超时/脚本报错）已经被这三个码完整覆盖，新增会重复 #1499 记过的"归因码语义重叠"教训。
- 重试循环复用 §7.1 的"提示协议"机制（模型把脚本放进标记代码块 → 解析 → 沙箱执行 →
  非零退出回喂真实 stderr → 上限 3 次），不重新发明。

## §6 导入路径

**走 starter-pack 导入**（`importSkillStarterPack`），不走 URL 导入——URL 导入的
天然联想对象是"从某个仓库地址拉取"，容易被误读成"从 anthropics/skills 或某个
fork 拉取"，与 §0 的授权结论矛盾。starter-pack 是本地文件（
`<root>/<packId>/<version>.json`），内容是本 delta 原创写的三份 `DeclarativeContract`
JSON，物理上不存在从受限仓库读取代码的路径。

导入后仍过既有双重门禁——安全扫描（自动）+ 方法论审核（人工，提交人 ≠ 审核人）
——不新增、不跳过任何一道门。

## §7 明确不做（防止范围蔓延）

- 不做通用 Office 文档读取/解析能力（编辑存量文件是完全独立的能力，见 §2）。
- 不做沙箱内联网、不放宽 L1/L2 隔离边界的任何一条现有规则。
- 不改 pptx skill 已签的任何设计决定。
- 不引入 Python/LibreOffice 等非 Node 运行时。
- 不复制、不参照、不翻译 Anthropic 官方或任何社区 fork 的 SKILL.md 原文/脚本
  原文——三份 promptTemplate 是本 delta 原创撰写。
