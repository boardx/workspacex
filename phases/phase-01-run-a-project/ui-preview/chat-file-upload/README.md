# chat-file-upload（V9 文件上传）UI 原型 — 签核第 ① 件（UI）材料

> ADR-023 束级 `design-signoff.md` 第 ① 件（UI）的**截图材料**。对应束：
> `phases/phase-01-run-a-project/contracts/chat-file-upload/`。
> 本目录只产出**截图 + 本说明**；ui.md 的引用索引由 coord-main 写。
>
> ⚠ **纯前端 mock，不接后端。** V9-a 后端（`chat_message_attachments` 表 + 上传端点）
> 尚未建，这是**签核前的原型**——显式标注「原型 · mock 数据」，**不混进活路由**
> `apps/web/components/chat/chat-live-message-panel.tsx`（生产 composer 保持「无真实数据
> 不做假 UI」红线）。原型只在 `/preview/chat-file-upload` 下渲染。

## 怎么本地点开（dev server 能起、能点）
```bash
cd apps/web && PORT=3131 pnpm dev
# 浏览器打开，顶部一排链接逐态切换：
#   http://localhost:3131/preview/chat-file-upload?scene=default
```
`?scene=` 取值：`default | dragover | attached | uploading | error-oversize |
error-type | error-count | error-retry | remove-confirm`。
📎 按钮会真的开系统文件选择框、选真实文件会跑签核参数的就地校验、✕ 会弹二次确认——
不是静态图。

## 原型代码落点
- 组件（真实组件 Button/Textarea/Badge/Progress + 设计 token）：
  `apps/web/components/chat/chat-file-upload-preview.tsx`
- mock 数据 + **签核参数单一事实源**：`apps/web/lib/mock/chat-file-upload.ts`
  （`MAX_FILE_BYTES=25MB`、`MAX_ATTACHMENTS=10`、`MIME_WHITELIST`——UI 文案全读它，不写第二份）
- 场景枚举/解析（非 client，避免 server 调 client 报错）：`apps/web/lib/chat-file-upload-scenes.ts`
- 预览路由：`apps/web/app/preview/chat-file-upload/page.tsx`
- 截图脚本：`apps/web/scripts/shot-chat-file-upload.mjs`

## 截图清单（每屏每态一张）

| 文件名 | 界面态 | 对应 signoff 材料 | 说明 |
|---|---|---|---|
| `v9-composer-attach-default.png` | 默认 | ① 「composer 左侧 📎 按钮」 | 空 composer，左下 📎 附件按钮 + `N/10` 计数；底部常驻参数说明 |
| `v9-composer-attach-dragover.png` | 拖拽高亮 | ① 「拖文件到输入区高亮」 | 文件拖入时虚线落区 + 上传云图标 +「松开即上传」+ 参数提示 |
| `v9-composer-attach-attached.png` | 已挂附件（8 个） | ① 「附件预览条」/ ② UC1 | 8/10 稠密样本，混合 PDF/DOCX/XLSX/PPTX/PNG/CSV/MD/JPG；每条＝类型图标＋文件名＋大小＋「已就绪」＋✕ |
| `v9-composer-attach-uploading.png` | 上传中 | ① 「上传中显示进度」 | 混合态：1 条已就绪 + 2 条上传中（旋转图标 + 百分比 + 进度条） |
| `v9-composer-attach-error-oversize.png` | 失败·超大小 | ② UC3（>25MB） | 顶部就地报错横幅 + 出错附件条标红，标注「该文件 39.4 MB」，不静默丢弃 |
| `v9-composer-attach-error-type.png` | 失败·非白名单 | ② UC3（非白名单） | 报错「不支持的文件类型」并列出支持类型（读白名单单源） |
| `v9-composer-attach-error-count.png` | 失败·超数量 | ② UC3（>10 个） | 已达 10/10（计数转警示色），第 11 个被拒的横幅 |
| `v9-composer-attach-error-retry.png` | 失败·可重试 | ① 「上传失败可重试」 | 上传中断的附件条标红 + 「重试」按钮（网络类失败才可重试） |
| `v9-composer-attach-remove-confirm.png` | 二次确认·移除 | ① 「✕ 移除」+ R8 危险动作 | 点 ✕ 就地弹确认，含影响说明「它不会随这条消息发送」，取消/移除（destructive） |

testid 锚点（signoff ① 指定 + 本原型补齐，全部 kebab-case，D-35 合规）：
`chat-attachment-input`（📎 触发钮）、`chat-attachment-file-input`（隐藏 file 输入）、
`chat-attachment-chip-<id>`、`chat-attachment-remove-<id>`、`chat-attachment-remove-yes-<id>`、
`chat-attachment-remove-confirm-<id>`、`chat-attachment-retry-<id>`、`chat-attachment-error`、
`chat-attachment-dropzone`、`chat-attachment-count`、`chat-attachment-list`。

## 我替 UC/signoff 做的设计决定（sign-off 时人类请逐条看）
这些点 signoff 材料没写明，是我材料化时定的，**可被推翻**：

1. **附件预览用「竖排整条」而非「横排小 chip」。** signoff ① 只说「附件预览条（文件名+
   图标+大小+✕）」。25MB × 10 个 + 长中文文件名（如「产品全量演示录屏.mp4-封面帧.png」）
   横排小 chip 会挤成一行截断看不清——竖排整条才能容纳文件名 + 大小 + 状态 + 进度条 +
   重试。**这是「10 个 + 25MB 在 composer 里排布不下」的解法，没有偏离任何签核值。**
   代价：附件多时预览区较高。若人类要横排紧凑版，需重排。
2. **📎 达 10 上限时禁用（不是允许点了再报错）。** 沿用活路由「不渲染/禁用假按钮」惯例
   （#460/#728 P10）。超数量报错横幅仅用于「一次拖入多个、部分越限」的情形。
3. **类型/大小/数量错「不可重试」，只有网络类失败「可重试」。** signoff 说「上传失败可
   重试」；我把它限定为**传输失败**——选错文件重试没意义（得换文件）。用 `retryable`
   区分两类。
4. **`N/10` 计数常驻 + 底部常驻一行完整参数说明。** signoff 没要求常驻计数/说明；我加上
   让「25MB / 10 个 / 白名单」在**每个态**都可见，减少用户撞限才知道规则。
5. **移除二次确认写了「影响范围」文案**（「它不会随这条消息发送」），落实 R8「危险动作
   要显式 + 影响范围说明，不做孤零零红按钮」。这是设计取舍：也可做成「先移除 + 可撤销
   toast」。当前选二次确认。
6. **MIME 白名单在报错文案里展开为人读串**（PDF、DOCX…）。csv 归到「表格」类图标
   （与 xlsx 同 `FileSpreadsheet`）；txt/md 归「文本」类（`FileText`）。图标归类是我定的。

## R8 线索之间的矛盾与处理
- signoff ① 说「附件预览条」用词像**横排 chip**，但 ② UC1「一条消息可挂多个」+ 参数
  「≤10 个、单个 ≤25MB」要求容得下长文件名与进度/重试/错误。二者张力我按「竖排整条」
  收敛（见设计决定 1），**未改任何签核数值**，只改了排布形态。若人类认为必须横排 chip，
  请在第 ① 件签核时点出，我改。

## 建议人类在束级 design-signoff.md 第 ① 件重点核对的 3 处
1. **附件预览的「竖排整条 vs 横排 chip」**（设计决定 1）——这是与 signoff 字面用词唯一
   有出入的地方，且直接决定 composer 高度与信息密度。
2. **三类失败的文案与「可否重试」的划分**（error-oversize / error-type / error-count /
   error-retry 四张图）——校验提示是否准确反映签核值、重试是否只给网络失败。
3. **移除二次确认 vs 可撤销 toast**（remove-confirm 图 + 设计决定 5）——危险动作的交互
   形态，R8 只要求「显式 + 影响说明」，两种都满足，需人类定一种。
