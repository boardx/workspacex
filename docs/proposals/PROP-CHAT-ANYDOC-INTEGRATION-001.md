# anydoc 集成提案：附件「任意文件 → Markdown」转换层（PROP-CHAT-ANYDOC-INTEGRATION-001）

> **状态：提案，未实现。** coord-main 2026-08-11 派工（人类上午指令：把 firecrawl/anydoc 纳入
> context engine，支持「任何文件转 markdown 读取」）。这是 **V9-b 转换层（W1）** 的选型提案，
> coord-main 审后再动代码。不新增签核项——文件大小/白名单/张数等参数已由人类签核（见
> `chat-file-upload` 束），本文只定「怎么把已签核的附件转成 markdown 进 context」。
>
> ⚠ 边界：V9-a（上传+存储+预览）先落地；本文的转换层是 V9-b，进 context engine 的 **L3 检索层**
> （见 `PROP-CHAT-CONTEXT-ENGINE-001.md` §4.4）。`ModelCallPort` 契约不动。

## 1. 实测确认的 anydoc 事实（本机 npm + 真跑，不是转述）

- **包**：`@firecrawl/anydoc@0.1.8`（scoped；注意 unscoped 的 `anydoc` 是**无关**的
  "node web server"，别装错）。主包仅 49KB（JS wrapper + `index.d.ts`）。
- **分发形态**：napi-rs **预编译原生二进制**，经 `optionalDependencies` 按平台拉取：
  `darwin-arm64/x64`、`linux-x64/arm64-gnu`、`linux-x64/arm64-musl`、`win32-x64-msvc`，
  每个 ~7–8.4MB。**安装期不需要 Rust 工具链**（拉对应平台的预编译 .node），实测 `npm install`
  9s、只装匹配当前平台那**一个**二进制（本机 darwin-arm64 7.2MB）。
  ⇒ coord-main 担心的「native binding 在 CI/devapp 的构建面」比预想低：不是 Rust 现场编译，
  是拉预编译产物；风险点转为「① CI/devapp 安装期能否访问 npm 拉 optionalDependency ②
  devapp 的 libc 是 gnu 还是 musl（决定拉哪个 linux 二进制）」——两条都要在动代码前核实。
- **API**（`index.d.ts`）：
  - `toMarkdownBytes(bytes, format?): Promise<string>`——**从字节转**，正好吃我们上传的 buffer，
    不落临时文件。异步。
  - `toMarkdown(path): Promise<string>`、`toDocument(bytes, format?): Promise<Document>`（结构化）。
  - `formatFromExtension(ext)` / `formatFromPath` / `formatFromBytes`。
- **失败面（真实 `ConvertErrorCode` 枚举，不是我编的）**：
  `unsupported`（无法转换的格式，**含 image-only/扫描件 PDF**）、`malformed`（结构不可用）、
  `encrypted`（加密/带密码）、`resourceLimit`（越过解压/嵌套/节点数安全上限）、
  `missingPart`（缺必要部件）、`io`（读不到文件，仅 `toMarkdown`）。
  ⇒ 界面异常态可以逐条映射，不用猜。

## 2. 实测性能（本机 arm64，25MB 上限，CSV 为例）

| 输入 | 耗时 | 输出 md | RSS 增量 |
|---|---|---|---|
| 1MB CSV | 131ms | 1.2MB | +38MB |
| 10MB CSV | 1.27s | 11.9MB | +301MB |
| 25MB CSV | **3.2s** | 29.7MB | **+711MB** |

**关键结论：快，但吃内存。** 25MB 文件转换峰值 RSS ~700MB（约输入的 **28×**）。CSV 是**最坏形态**
（整表在内存里物化成一张巨大的 markdown 表），真实 PDF/docx 可能更省，但白名单里 CSV 是签核类型，
必须按它规划。时间近似线性（~130ms/MB），**内存是约束、不是时间**。

⚠ 未实测面（诚实标注，不猜）：
- 真实 PDF / docx / pptx / xlsx 的耗时/内存分布——本机没有现成的 25MB 各格式样本，建议动代码前
  用一批真实文件补测。
- `resourceLimit` 的具体阈值（解压炸弹/深嵌套防护）在什么输入下触发——安全相关，值得单测。
- **format 必须显式传**：`formatFromBytes(csv)` 实测**探测不出 CSV**（CSV 无 magic bytes）→ 返回
  错误格式 → `unsupported`。我们有附件的 filename/MIME，用 `formatFromExtension`/显式 `Format`
  即可，但这条是集成硬约束：**不要靠嗅字节，靠已知的 filename/MIME**。

## 3. 集成设计选型

### 3.1 进程内同步 vs 队列异步 —— 推荐**队列异步 + 并发上限**
实测的 ~700MB/25MB 内存峰值是决定性因素：
- **进程内同步**（上传请求里直接转）：实现最简，但一个 25MB 文件占 ~700MB、若干并发就能 OOM
  api 进程；且转换 3s 会把 HTTP 请求拖长。**否决**（除非把可同步转换的大小上限压到远低于 25MB）。
- **队列异步（推荐）**：上传（V9-a）先把文件存下、`extracted_ref` 置 null；一个**带并发上限的
  worker**（复用本仓已有的队列/后台机制，若有）逐个把附件转 markdown、写 `extracted_ref`。
  并发上限按内存预算定（如「同时最多 N 个转换」，N × 700MB < 可用内存）。转换是 V9-b，
  用户上传（V9-a）不被转换耗时阻塞。
- **折中**：小文件（如 <2–3MB，实测 RSS <100MB）可进程内同步转、即时可用；大文件入队。
  两档阈值由内存预算定，写进配置（同 opt-in 纪律）。

### 3.2 转换层的位置（洋葱 + 端口）
- 新 application 端口 `AttachmentToMarkdownPort { convert(bytes, format): Promise<Result> }`，
  domain 不认识 anydoc；`infrastructure` 用 `@firecrawl/anydoc` 实现它（依赖倒置，同本仓
  ConfiguredModelProvider/ASR provider 的形状）。**anydoc 只出现在 infrastructure 一层**，
  换实现（或将来加云 OCR 兜底扫描件）不动上层。
- 转换结果（markdown）存进 `chat_message_attachments.extracted_ref` 指向的对象（已在 V9 契约里预留）。
- L3 检索：`extracted_ref` 的 markdown 进 context engine 的检索召回层（不整篇塞 ModelCallInput，
  按相关性召回片段——正是人类担心的「context window 超负荷」的解法，见分层历史 §4.4）。

### 3.3 失败面处理（映射真实 ConvertErrorCode）
| anydoc code | 含义 | 我们怎么处理 |
|---|---|---|
| `unsupported` | 无法转换（**扫描件/image-only PDF**） | 标记该附件「无法提取文本」（第一版不引入云 OCR，符合 coord-main「不引入云服务」） |
| `encrypted` | 加密/带密码 | 标记「加密文件，未提取」，可提示用户 |
| `malformed`/`missingPart` | 结构损坏 | 标记「文件损坏，未提取」 |
| `resourceLimit` | 越过安全上限 | 标记「文件过大/过复杂，未提取」——安全防护，不是 bug |
| `io` | 读不到 | 重试或标记失败 |
- **失败不删附件、不 fail 上传**：附件本体（V9-a 存下的）永远在；只是 `extracted_ref` 保持 null
  + 一个失败原因。用户还是能下载原件，只是它不进 context。这与本仓「无真实数据不做假 UI」一致。

## 4. 不覆盖面（coord-main 已点，本文确认）
- **扫描件 PDF（无文字层）**：anydoc 返回 `unsupported`。第一版标记「无法提取文本」，不引入云 OCR。
- **URL 抓取**：anydoc **不做**。人类提的「附件的链接」是单独方案 → 见 `PROP-CHAT-LINK-INGESTION-001.md`
  （W2），**不硬套 anydoc**。

## 5. 需要 coord-main 裁 / 动代码前必核实
1. **同步/异步选型**：推荐队列异步 + 并发上限（+ 小文件同步折中）。要不要引入队列 worker？
   本仓有没有现成的后台队列可复用？——需 coord-main 确认基础设施。
2. **devapp/CI 的 libc**（gnu vs musl）+ 安装期 npm 可达性——决定 optionalDependency 能否拉到。
3. **补测真实 PDF/docx/pptx/xlsx 的耗时/内存**（本文只测了 CSV 最坏形态）。
4. 引入 `@firecrawl/anydoc` 为**生产依赖**本身要过依赖评审（新原生依赖、许可证 MIT 无碍、
   ~8MB 二进制进部署面）。

## 6. 分期（不打乱已签核顺序）
```
V9-a（已签核，先落）：上传 + 存储 + 预览；extracted_ref 恒 null
V9-b / W1（本文）：AttachmentToMarkdownPort + @firecrawl/anydoc 实现 + 队列转换 + 进 L3
W2（另文）：URL/链接 ingestion 评估（不实现）
```

---

*本文档由 dev-chat-e2e worker 2026-08-11 整理；anydoc 事实与性能均本机实测（npm 安装 +
`toMarkdownBytes` 真跑），未实测面已诚实标注。提案待 coord-main 审，审后再动代码。*
