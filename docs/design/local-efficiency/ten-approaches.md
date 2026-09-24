# 本地版效率与质量：十条方案 + 十轮迭代计划（#3872）

写这份的前提是**我们已经有实测基线**，所以每条方案都对着一个数字，而不是"听起来更好"。

## 基线（实测，2026-09-23/24，Apple M5 / 16 GB / macOS 26.5）

| 指标 | 实测 |
| --- | --- |
| 更新后首次启动 | **33.7 s** 才写出第一行日志（屏幕上什么都没有） |
| 正常启动到界面 | **10.7 s**（模型就绪 +4.3 / API +7.7 / Web ready +9.8） |
| 冷机第一条消息 | **约 18 s** 等模型装载，**期间无提示** |
| 温机首 token | **0.08 s** |
| 吞吐 | **34–35 tok/s**（九分线 ≥7） |
| 长提示前缀复用 | `total=9941 matched=3882`、`total=9678 matched=2033` → **20–39%** |
| 包体 | **7,021 MB**（从 12,706 MB 砍下来），96,182 个文件 |
| 关机收尾 | 459 ms ～ 5,268 ms（方差 11 倍） |

## 研究结论中**推翻我先前判断**的三条

1. **那 33.7 s 的主因是「没有 stapled 的公证票据」。** 没有票据时 Gatekeeper 要做完整评估、
   甚至联网取票。所以它既不是字节数（R16 实测减 12% 无效）也不主要是文件数
   （R17 实测减 34% 只换 13%）——**签名 + 公证 + staple 才是那条杠杆**。
2. **tsx 不是 API 那 8 秒的原因**：业界测得 tsx 冷启动只加 50–100 ms。
   我先前说"编译 API 才是效率杠杆"是错的。有真实案例的是
   **NestJS 惰性模块加载，实测砍 60% 冷启动**。
3. **吞吐不是战场**：LM Studio / Ollama 在同一模型上 tok/s 基本无差，
   差距全在 overhead。我们 34 tok/s 已是九分线五倍，**不该再优化吞吐**。

## 十条方案

按「每单位工作量能动多少实测数字」排，不按好听程度。

| # | 方案 | 针对的实测数字 | 可证伪判据 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | **稳定提示前缀**（工具 schema 顺序、system prompt 逐字不变） | 长提示复用 20–39% | ollama 自报 `matched/total` 上升；长提示 TTFT 下降 | 可做 |
| 2 | **首屏就是应用**，不是进度页；未就绪的区域各自显示状态 | 10.7 s 到"可交互" | 首个可交互元素出现的时刻 | 可做 |
| 3 | **冷路径「正在加载模型 x%」** | 18 s 无提示 | 装载期间界面有确定性百分比 | 可做 |
| 4 | **NestJS 惰性模块加载** | API +7.9 s | API listening 时刻 | 可做 |
| 5 | **停止键真的停掉采样** | 未取证 | 掐断后 runner CPU / tok/s 归零 | 可做 |
| 6 | **V8 snapshot 主进程** | Electron 主进程启动 | 首行日志时刻（排除公证因素后） | 可做 |
| 7 | **元任务不与聊天抢模型槽**（人类决策：**不加 2B**，所以改为排队与降级） | 起标题会把回复挤后面 | 用户 run 的等待时间；模型调用次数 | 可做 |
| 8 | **日志一键导出** | 只有"打开数据目录" | 菜单里能导出一个可发走的归档 | 可做 |
| 9 | **29 处 `window.alert/confirm` 换成应用内提示** | 桌面壳里是 Chromium 模态，`confirm` 阻塞渲染 | 计数归零；关键路径不再阻塞 | 可做 |
| 10 | **签名 + 公证 + staple** | **33.7 s** | 首行日志时刻 | **卡人类：需要 Apple Developer ID** |

## 明确**不做**的（避免重复投入）

- **继续剪包换速度**：R16/R17 已证伪（减字节无效、减文件数弱）。剪包只对下载体积有意义。
- **优化吞吐**：34 tok/s 已远超线，且研究显示 wrapper 之间无差异。
- **引入 Laya**：#3770 已实测——准确率输给正则（0.775 vs 0.850），常驻 1.7 GB、
  加载 20 s、DMG +1.5–2 GB。三种配置（常驻/按需/组合）都不成立。
- **编译 API 换启动速度**：研究显示 tsx 只占 50–100 ms，方向错了。
  （编译对**包体和文件数**仍有意义，但那不是速度杠杆。）
- **加 2B 元模型**：人类决策 2026-09-24 不加。

## 十轮怎么排

每轮一条，落地时都要：① 先写可证伪预测 ② 实测前后对比 ③ 反证（把改动去掉要变红）
④ 结果与预测不符时**说不符**，不改事后解释。

R1 提示前缀 → R2 首屏 → R3 模型装载进度 → R4 NestJS 惰性 → R5 停止键 →
R6 V8 snapshot → R7 元任务排队 → R8 日志导出 → R9 原生弹窗 → R10 复盘重打分。

第 10 条（签名）不占轮次——它随时可以插入，一旦拿到证书就先做它，因为它同时解掉
33.7 s、维度 8 的更新通道、和维度 2/5/6 的真机验收。

## 研究来源

- Gatekeeper / 公证 / staple 与首启延迟：<https://www.forasoft.com/blog/article/the-pain-of-publishing-electron-apps-on-macos-303>、<https://www.electron.build/docs/features/code-signing/notarization/>
- Electron 启动优化（V8 snapshot、惰性窗口）：<https://palette.dev/blog/improving-performance-of-electron-apps>、<https://www.devas.life/how-to-make-your-electron-app-launch-1000ms-faster/>
- Ollama 前缀缓存与 keep-alive：<https://mljourney.com/ollama-keep-alive-and-model-preloading-eliminate-cold-start-latency/>、<https://matteogiardino.com/en/blog/ollama-mlx-apple-silicon>
- NestJS 惰性模块加载 / tsx 开销：<https://docs.nestjs.com/fundamentals/lazy-loading-modules>、<https://betterstack.com/community/guides/scaling-nodejs/tsx-vs-native-nodejs-typescript/>
- 本地优先 AI 应用的包体区间与 overhead 观察：<https://www.sitepoint.com/definitive-guide-local-first-ai-2026/>、<https://modelpiper.com/blog/local-ai-platforms-compared-mac>
