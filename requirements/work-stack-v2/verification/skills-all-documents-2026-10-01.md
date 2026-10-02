# 全 Skill 验收：文档与文件专项（2026-10-01）

这份记录验证实际文件执行和边界，不代表模型质量、数字人端到端任务或生产发布已通过。
使用合成 PDF/Office/WAV/MP3/CSV，未访问用户私人附件或失败对话。

## 库存与覆盖

以下是 7 个实际运行时 Skill 的专项覆盖，不是 200 项 work.stableId 库存的完成统计。
WX-S009 / WX-S018 是能力标识，不能映射成 work 的 S009 / S018。

| Skill | 权威来源 | 已执行的确定性验证 | 尚未验证 |
| --- | --- | --- | --- |
| pdf-create | platform-skill-catalog / office-docs-skill-content | 真实 pdf-lib 生成、PDF 读回、空页/错误文件反证、L2 越界拒绝 | 原生会话交付；生产镜像 CJK 字体与渲染 |
| docx-create | 同上 | 真实 docx 生成、OOXML 读回、中文表格列宽、错误 Office 类型反证、L2 拒绝 | 原生会话交付和视觉排版质量 |
| pptx-create | 同上 | 真实 pptxgenjs 生成、OOXML 读回、错误压缩包反证、L2 拒绝 | 原生会话交付和视觉排版质量 |
| xlsx-create | 同上 | 真实 exceljs 生成、OOXML 读回、错误 Office 类型反证、L2 拒绝 | 原生会话交付；公式重算不在既有保证内 |
| document-understanding（WX-S018，1.2.0） | standard-document 1.2.0 | 原生 PDF/DOCX/PPTX/XLSX 定位提取、损坏/不支持输入拒绝、原件不变；API/Python 工具边界 | 完整 native owner → sandbox → artifact 链、生产 OCR 镜像 |
| audio-transcription（WX-S016，1.1.1） | standard-audio 1.1.2 | 真实 FFmpeg WAV/MP3 解码、分块时间/哈希、输入/时长/损坏拒绝、失败输出清理；API/Python 边界 | 真实 ASR 服务、模型识别质量和原生会话交付 |
| meeting-minutes（WX-S009，1.1.2） | standard-audio 1.1.2 | 依赖的音频输入/工具边界已覆盖 | 本 Skill 的真实纪要任务与事实完整性，不能用转录测试代替 |

固定版本来自实际 starter pack 的 semanticVersion；packVersion 与技能版本并不总相同。
角色 pending/候选状态不能因这份局部执行证据变成 verified。

## 执行结果

- Python 六个 native/document/audio 边界文件：59 passed，11 skipped。11 条需要显式拥有的 E003 integration container，标为 **BLOCKED**，不计通过。
- API standard-document-tools、standard-audio-tools、native-session-files：3 文件 / 29 passed。
- Node 22 Office 生成、中文表格及 L2 隔离：7 文件 / 34 passed，1 skipped。未启用的外网探测不计通过，L1 容器网络隔离也不能由 L2 测试代替。
- Node 22 输入原件不可写、路径/别名/重复/base64 拒绝、权限警告与 Electron 子进程：4 文件 / 14 passed。
- `verify-anydoc-real-fixtures.py`：生产离线 AnyDoc CLI 对 PDF/DOCX/PPTX/XLSX/CSV 实际生成 Markdown 并读回原始值；四种损坏二进制文档拒绝且不产出 Markdown；CSV 普通文本本来有效，不伪造损坏拒绝规则。
- `verify-document-structure-fixtures.py`：PDF 原生两页与跨页重复表头分组、DOCX 5 chunks、PPTX 5 chunks、XLSX 6 chunks（包含公式原文与合并地址）；原件 hash 不变；不支持格式与四种损坏文件均拒绝且无部分输出。
- `verify-audio-real-fixtures.py`：在禁网的临时 `/inputs` mount 中执行生产 `decode-audio.py`。真实 WAV/MP3 解码通过；PCM 哈希、分块时间、原件不变，以及错误 hash、字节上限、时长上限、非原件路径、损坏音频拒绝与残留输出清理通过。没有调用 ASR。

日志（本次工作区，未包含私人文档）：
`/tmp/skills-all-documents-python.log`、`/tmp/skills-all-documents-api-boundary-escalated.log`、
`/tmp/skills-all-documents-office-node22-escalated.log`、`/tmp/skills-all-documents-inputs.log`、
`/tmp/skills-all-documents-structure.log`、`/tmp/skills-all-documents-anydoc.log`、`/tmp/skills-all-documents-audio-real.log`。

## 环境反证与处理

宿主是 Node 24，仓库 `.nvmrc` 和 skill-sandbox Dockerfile 指定 Node 22。首次生成测试在
`--experimental-permission` 上失败；这是宿主版本不符，不是确认的生产缺陷。使用 npm registry 的
`node-linux-x64@22.23.3` 到 `/tmp/skills-node22` 后重跑。默认执行沙箱另有本地 IPC/子进程 stdout 限制，
在获准的本地测试执行环境重跑后通过。没有为让测试通过修改生产权限白名单或去掉权限模型。

结构提取使用现有系统 Python 及已有 pdfplumber 0.11.8 / python-docx 1.2.0 /
python-pptx 1.0.2 / openpyxl 3.1.5；pytest 使用已有 `/tmp/role-acceptance-venv`。
该 venv 缺少文档格式库，不能代替系统 Python 跑实际结构提取。

## 复跑直接文件脚本

在仓库根目录，用已有格式库的 Python：

```sh
python apps/skill-sandbox/tests/verify-document-structure-fixtures.py
python apps/skill-sandbox/tests/verify-anydoc-real-fixtures.py --node /tmp/skills-node22/package/bin/node
```

音频脚本要求真实隔离的 `/inputs` 与可写 `/workspace`，不创建宿主根目录。
当前环境使用下列一次性 namespace（没有启动服务/新容器，没有修改宿主 `/inputs`）：

```sh
mkdir -p /tmp/skills-all-isolated-inputs
bwrap --unshare-net --unshare-pid --die-with-parent --tmpfs / \
  --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
  --ro-bind /opt /opt --ro-bind /bin /bin --ro-bind /etc /etc \
  --bind /workspace /workspace --bind /tmp /tmp \
  --bind /tmp/skills-all-isolated-inputs /inputs --dev /dev --proc /proc \
  --chdir /workspace python \
  /workspace/chat-role-skill-scope-fixes/apps/skill-sandbox/tests/verify-audio-real-fixtures.py
```

路径按实际 checkout 替换。只有此 verifier 事先确认不存在的合成输出前缀才会被清理。

## 未完成项

- 配置显式拥有的原生会话后，执行当前被跳过的 11 条 native 测试，以及真实 document/audio 的授权、取消、重启恢复和工件交付链。
- 使用既有生产镜像验证 CJK PDF 可读性、扫描件 OCR 与语言数据；当前宿主只有英文 Tesseract，不能声称中文 OCR 已通过。
- 配置真实 ASR 后验证识别结果与原音频，再单独验收 meeting-minutes 的真实任务。

本专项未确认需要修改的生产执行缺陷；新增真实文件反证与复跑材料。不能将 BLOCKED 项勾选完成。
