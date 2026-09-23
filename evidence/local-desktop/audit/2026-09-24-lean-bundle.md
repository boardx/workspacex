# R16：剪掉 1.5 GB 打包垃圾，并补上「包完整吗」这道发布门

实测机器：Apple Silicon / 16 GB / macOS 26.5。产物由 `apps/desktop` 本地构建。

## 剪了什么，以及判据

判据不是「看着像开发依赖」，是逐条核过运行时到底加不加载：

| 包 | 大小 | 为什么运行时不需要 |
| --- | --- | --- |
| `electron@33.4.11` | **708 MB** | 应用本身就是 Electron（`Contents/Frameworks` 里那份）；bundle 里的运行时代码对 electron **零 import** |
| `app-builder-bin` | 207 MB | electron-builder 自己的二进制，打完包就没用了 |
| `workerd` ×3 个版本 | 303 MB | wrangler 的运行时，给 `apps/coord-gateway` 用 |
| `@cloudflare/workerd-darwin-arm64` ×3 | 289 MB | 同上（平台二进制，三个版本各一份） |
| `typescript@4.9.5` | 64 MB | 运行时用 tsx（esbuild），不做类型检查 |

`up()` 启动的是 api / web / skill-sandbox / asr-gateway / deep-agent / ollama（外加延后的
model 装载）——**没有 coord-gateway**，而 `packages/local-runtime` 对 wrangler/workerd 零引用。

## 结果

| | 剪之前 | 剪之后 | 省下 |
| --- | --- | --- | --- |
| `.app` | 12,706 MB | **11,204 MB** | 1,502 MB |
| `bundle/` | 3,712 MB | **2,209 MB** | 1,503 MB |

没剪的（下一轮单独验）：`@next+swc-darwin-arm64` 110 MB、`monaco-editor` 98 MB、
`mermaid` 83 MB、`echarts` 54 MB、`lucide-react` 43 MB。生产构建之后它们**看起来**已经
进了 `.next`，但「看起来」不是判据。

## 反证：剪包是危险操作，判据必须是「包还能用」

`check-bundle-lean.mjs` 只查「不该在的在不在」，头注里写明它**证明不了包能用**。
真正的反证是把应用跑起来——**全新 userData 的完整首次运行**，这条路径碰的代码最多：

| | |
| --- | --- |
| 从 `open` 到首行日志 | 38.7s（重新打包后的首次启动，见下） |
| 模型导入 100% | +20.3s |
| 模型就绪 | +23.8s（延后，不挡界面） |
| 沙箱 / 语音 / API / deep-agent / Web ready | +26.3 / +28.7 / +30.5 / +34.2 / **+35.2s** |
| 界面可访问 | 75.3s |
| **登录 → 发消息 → 标题自动生成 → 真实模型答案** | **37 秒后出字** ✅ |

标题被自动生成成「存储相似内容查找的数据库」——这一条顺带证明元模型链路也通。

## 反证过程中抓到的真缺陷（不是剪包造成的）

日志里有一条 `⚠ skill 沙箱没有预装模块目录：pptx / docx / xlsx / pdf 生成类 skill 会以
MODULE_NOT_FOUND 失败`。我先误判成自己剪坏了——查下来不是：

- `apps/skill-sandbox/preinstalled` 由 `scripts/local-bundle/prepare-sandbox-modules.sh`
  生成、**不入仓库**，而 `dist:mac` **不跑那个脚本**。我的新 worktree 从没跑过它。
- 这和 R15 的 web 产物是**同一个家族**：发布脚本依赖「开发者手工跑过某些脚本」，
  漏了就发布一个少能力的包，而**唯一的症状要等用户真去生成一个文档才出现**。

⚠ 我一开始的 grep 判据也错了一次：我搜 `MODULE_NOT_FOUND`，命中的是一条**文案里含
这几个字**的告警，不是真的缺模块。差点把一条正常的能力提示报成剪包事故。

### 修法：接进「能不能发布」那道门

`releasable.ts` 加 `missingPreparedDirs`，`check-releasable.mjs` 检查五个由准备脚本
产出的目录（`skill-sandbox/preinstalled`、`apps/web/.next`、`Resources/python`、
`Resources/bin`、`Resources/models`）。对当前产物实跑，它把缺失的那个报成**第 1 条阻塞**，
且只报了那一个——同时反证了我的剪包没有碰到另外四个。

反证：删掉这段阻塞逻辑 → 13 条里红 3。

## 顺带确认的一件事

那 38 秒的首次启动税**与包体积同方向但不成比例**：12.7 GB 时 37.4s，11.2 GB 时 38.7s。
所以剪掉 1.5 GB **没有**明显缩短它（在噪声内）。我先前说「剪包会同时缩短它」，
按这两个数据点**不成立**——要么它主要由文件**个数**而不是字节数决定，
要么还有别的主导因素。这条以后要么拿更多数据点说清，要么别再声称。
