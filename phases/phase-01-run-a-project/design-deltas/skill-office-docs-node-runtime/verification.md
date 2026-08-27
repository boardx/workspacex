# verification · 新增 Word/PDF/Excel 文档生成 skill

> 每条都要求**可执行、可复现**，且**每个门控配一条反证**——本仓已九次踩过
> "全绿但空转"。三个 skill 的验收结构与 `skill-sandbox-execution`（pptx）逐条对齐，
> 复用同一套隔离/失败码/重试断言，不重新发明一套。

## V1 端到端：三个 skill 各自真的产出合法文件

真栈 e2e，三条各跑一遍（导入 skill → 挂载 → chat 触发 → 轮询到终态 → 下载产物）：

- **V1-docx**：产物用 `docx` 库自身或 `mammoth` 读回，断言标题/正文/表格内容与请求
  逐条对应；zip 结构合法（`.docx` 本质是 OOXML zip）。
- **V1-xlsx**：产物用 `exceljs` 读回，断言 sheet 名/表头/行数据与请求逐条对应；
  若请求里带了公式，断言公式文本原样写入（不断言求值结果——§2 已声明不做求值）。
- **V1-pdf**：产物用 `pdf-lib` 或 `pdf-parse` 读回，断言页数、文本内容与请求逐条
  对应；PDF 文件头/结构合法（能被解析库正常打开不抛错）。

⚠ **反证 V1-CP（三条各一份）**：把沙箱执行结果替换成"返回空文件"，对应那条
必须变红。少了它，一个"总是回一个 0 字节文件"的实现会全绿——与 pptx delta 记的
同一条教训。

## V2 隔离边界未被放宽（复用 pptx delta 的 V2，验证三个新依赖没有开新口子）

- **V2-a（L2 进程层）**：三个新 skill 各提交一个越权脚本（写 `/etc/x`、起子进程、
  读 workdir 外文件），必须以 `ERR_ACCESS_DENIED` 失败。
- **V2-b（L1 容器层）**：三个新 skill 各提交一个 `fetch(...)` 脚本，必须失败——
  证明新依赖没有意外拉进任何需要出网的子功能（如 `exceljs` 某些图表渲染路径、
  `pdf-lib` 某些字体加载路径若默认联网下载，会在这里现形）。

⚠ **反证 V2-CP**：把容器 `network: none` 摘掉，V2-b 三条必须全部立刻变红。

## V3 预装依赖真的不需要运行时安装

三个 skill 各提交一个不含 `npm install` 的脚本，断言 `require('docx')` /
`require('exceljs')` / `require('pdf-lib')` 各自成功（镜像自检已装好）。

⚠ **反证 V3-CP**：从镜像里去掉某个包的预装，对应那条必须变红（证明这条断言真的在
测"预装是否生效"，不是巧合通过）。

## V4 重试循环复用验证（同 pptx delta V3，逐条对三个新 skill 各跑一遍）

注入"第一次必失败、第二次成功"的确定性替身，断言最终成功且确实执行了 2 次。

⚠ **反证 V4-CP**：把重试上限改成 1，三条必须全部变红。

## V5 三个既有失败码在新 skill 上同样可达、不串味

`SANDBOX_UNAVAILABLE`/`SANDBOX_TIMEOUT`/`SCRIPT_FAILED_AFTER_RETRIES` 三个码
各在三个新 skill 上各触发一次，断言归码正确且 `SCRIPT_FAILED_AFTER_RETRIES` 响应
带着最后一次真实 stderr（不是"生成失败请重试"）。

## V6 导入路径真的是本地 starter-pack，不是远程拉取

断言 `importSkillStarterPack` 的导入源是本地 `FileSkillStarterPackSource` 文件，
且这三份 JSON 声明文件里**不包含**任何指向 `anthropics/skills` 或任何 fork 仓库
URL 的引用（`contract.md` §0/§6 的授权边界的机械核验）。

⚠ **反证 V6-CP**：往任意一份 promptTemplate 里塞一个指向外部 skill 仓库的 URL，
本条必须变红——防止未来有人"顺手"从受限仓库抄一段回来。

## V7 双重门禁未被绕过

三个 skill 各自的导入 → 安全扫描 → 方法论审核（提交人 ≠ 审核人）→ `已启用`
全流程走一遍，断言：跳过审核步骤时 skill 停在"待审核"状态，不能被挂载到线程。

## V8 不回归

`skill-sandbox-execution`（pptx）既有全部断言仍然全绿——新依赖预装、镜像自检新增
一行，不改变 pptx skill 自己的任何行为。
