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

## V7 中英文支持（2026-09-06 人类反馈补充：「excel/pdf/word/ppt 都要很好地支持中英文」）

原 §2 把"字体管理"划在范围外，pdf-create 的 SKILL.md 因此写着"内置字体不支持中文，
建议改用 docx/xlsx"。实测（devapp 通用助手，用户要一份中文 PDF）：模型照这句话把
用户劝退了——**规范里写着的限制，落到用户那里就是功能缺失**。本次把它补上。

- **V7-pdf**：镜像预装 CJK 字体（`fonts-droid-fallback` 的单字面 TTF，
  路径由 `SKILL_SANDBOX_CJK_FONT` 给出），沙箱把该文件的真实路径加进只读授权并
  以环境变量传给脚本。在 **`network: none`** 容器里跑一段"嵌入该字体画中文"的脚本，
  断言：① 每个汉字的字形编号 ≠ 0（0 = `.notdef`，就是用户看到的方框本身）；
  ② 这些字形编号真的出现在页面 content stream 里；③ 字体真的被内嵌
  （`/FontFile*` + `Identity-H`，走**解析后的间接对象**判定——pdf-lib 会把对象写进
  压缩流，在原始字节里 grep `/FontFile2` 是稳定的假阴性）。
  → `apps/skill-sandbox/tests/produces-real-cjk-pdf.test.ts`
- **V7-prompt**：SKILL.md 正文与镜像不许漂移——正文里教的环境变量名/库名与沙箱
  实际提供的逐字一致，且旧的"做不到中文"劝退话术不许回来。
  → `apps/api/tests/skill/office-docs-cjk-guidance.test.ts`
- **V7-ooxml**：docx/xlsx/pptx 三者是 OOXML，中文是 UTF-8 文本，**本来就不会乱码**，
  不需要嵌字体；这三份正文只交代字体名怎么选（写一个中文机器上没有的西文字体名会让
  中文走 fallback）。同一条测试锁住"它们不要去教嵌字体"，避免把 PDF 的做法误植过去。

⚠ **反证 V7-CP（两条，均已实跑）**：
1. 同一段脚本改用 `StandardFonts.Helvetica` 画同样的中文 → 必须失败（WinAnsi 编码器
   抛错），证明 V7-pdf 测的是"嵌入字体这条路"，不是"随便画点什么都能过"。
   （已写进测试文件，与主断言同跑。）
2. 把 `SKILL_SANDBOX_CJK_FONT` 从容器里摘掉再跑同一段脚本 → 实测 `exitCode 1`、
   产物为空，证明这条绿依赖的是**镜像里真的有那份字体**，不是别的什么巧合。
