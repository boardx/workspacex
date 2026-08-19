# contract · 试跑接真执行（沙箱化脚本执行 + 真实产物）

> 规范唯一来源。签核口径见同目录 `design-signoff.md`，验收口径见 `verification.md`。
> 全部设计取舍由 spike 实测支撑，证据见 issue #1575。

## §1 问题陈述

现状（#1570 ③ 实测）：试跑 = 一次 `ModelCallPort.complete()`，无工具、无文件系统、无沙箱。
对 pptx 这类**本质需要跑脚本产文件**的 skill，它结构上永远只能产出文字，
产不出 `.pptx`。真实模型回复里出现字面 `<tool_call>` 块 = 它在够一个够不到的工具。

## §2 范围（首个切片）

**做**：从零创建 deck 这条路径（`pptxgenjs`，纯 Node）。
**不做**：编辑存量 deck（`python-pptx`）、转旧 `.ppt`（LibreOffice）、视觉 QA 渲染
（LibreOffice + Poppler）、缩略图。

依据：pptx SKILL.md 决策表只有 Create 一行是纯 Node；其余三项各自拖一套语言/二进制
运行时，一起做会让镜像与范围膨胀数倍，且它们不是"拿到 pptx 结果"的必经路径。

⚠ 这是**范围**声明，不是"这些做不到"。后续切片可在同一沙箱服务里加运行时。

## §3 组件与依赖方向（洋葱约束）

```
interface/   SkillTrialRunController ──┐
                                       ↓ 只认应用层端口
application/ trial-run-skill.ts ── SkillSandboxPort（新增，本层定义）
                                       ↑ DI 由 kernel.module 接
infrastructure/ HttpSkillSandbox ──HTTP──▶ apps/skill-sandbox（独立服务/独立容器）
```

⚠ `interface/` 不得直接 import `infrastructure/`（`lint-arch-deps` 机械门控）——
与 `ORG_AGENT_MODEL_READER`（#1499）同一条先例：端口定义在 application，实现在
infrastructure，controller 只认端口。

## §4 隔离边界（两层，各挡各的，互不替代）

| 层 | 手段 | 挡住 | 实测证据 |
|---|---|---|---|
| **L1 容器** | 独立容器；`network: none`；只读 rootfs；非 root user；workdir 挂 tmpfs；memory / CPU / pids 上限；wall-clock 硬超时 | **网络外泄**、逃逸、资源耗尽 | 见下方 ⚠ |
| **L2 进程** | `node --experimental-permission --allow-fs-read=<workdir> --allow-fs-write=<outdir>`，**不给** `--allow-child-process` / `--allow-worker` | 文件越界读写、起子进程 | #1575 ④ 三条反证均 `ERR_ACCESS_DENIED` |

⚠⚠ **L1 不是"再加一层更安全"，是唯一能挡网络的那一层。**
实测（#1575 ⑤）：Node 权限模型**没有网络维度**，`fetch('https://example.com')`
在开着全部权限限制的进程里**照样 200 成功**。因此：

- 只有 L2 ⇒ 一个被注入的 skill 能把 workdir 里读得到的一切 POST 出去。
- 只有 L1 ⇒ 容器内仍可越界读写与起子进程，事故半径大。
- **两层都要**，且任何一层被摘掉都必须视为回归（`verification.md` 有对应反证）。

⚠ pptxgenjs **预装进镜像**：skill 原文写着「preinstalled — do not run `npm install` first」，
预装后其指令逐字成立；且 `network: none` 下容器本就无法出网装包，二者自洽。

## §5 产物落地

沙箱返回的文件 ⇒ `ObjectStore.putOnce(key, bytes, mime)`（**已存在**，
`application/artifact/ports.ts`，"Never overwrites" 语义）⇒ 试跑结果回一个可下载引用。

⚠ **不自动落成项目产物（artifact）**：试跑语义是"预演"，把文件自动塞进项目是另一件事
（有自己的绑定/版本/权限语义，见 `application/artifact/`）。用户要留下它，走既有的
落地产物路径显式操作。

## §6 契约增量（对既有 `skill-trial-run` 的改动）

1. **转异步**。实测单次真实模型调用（20KB system prompt）需 33.5s（关思考）～200-300s
   （开思考），叠加重试后必然远超 R9「>10s 转异步」。试跑改走既有 `AgentRun` 的
   提交 → 轮询形态，不再占用一条同步 HTTP。
   ⚠ 这会改变试跑的 API 形状，是本 delta 最大的契约面改动。
2. **新增失败码**：`SANDBOX_UNAVAILABLE`（服务不可达）、`SANDBOX_TIMEOUT`（超硬超时）、
   `SCRIPT_FAILED_AFTER_RETRIES`（回喂重试用尽仍失败）。
   ⚠ 与既有 `MODEL_UNAVAILABLE` / `DEPENDENCY_UNAVAILABLE` **不合并**——
   "模型没配好"、"沙箱挂了"、"模型写的脚本一直修不对"是三件运维动作完全不同的事，
   合成一个码会让线上无法归因（同 #1499 头注记过的同一条教训）。
3. **不改**授权口径（组织成员即可试跑）与既有错误码语义。

## §7 重试循环

- 模型带 `run_script` 工具 ⇒ 执行 ⇒ 非零退出则把 `exitCode` + 截断后的 `stdout/stderr`
  作为工具结果回喂 ⇒ 重新生成 ⇒ 上限 **N=3** 次（实测第 2 次即收敛，留一次余量）。
- 用尽仍失败 ⇒ `SCRIPT_FAILED_AFTER_RETRIES`，并**原样带回最后一次的 stderr**。
  ⚠ 不翻译成"生成失败，请重试"——那会让真实原因消失（同 #660 已记过的同一条纪律）。

## §7.1 ⚠ 落地修正：`run_script` 不是原生工具面，是提示协议（2026-08-19，coord 已裁定接受）

上面 §7 写的「模型带 `run_script` **工具**」在落地时被证伪了一个前提：
**`ModelCallPort` 没有工具调用面**。`ToolDefinition` / `ToolCallRequest` /
`ToolExchangeTurn`（#725）已在 **#741 被显式退役**，连同它们服务的 TS 进程内工具循环
一起删除（见 `apps/api/src/application/agent-run/ports.ts` 对应头注）。写 §7 时没有核实
这个前提 —— 这是设计侧的疏漏，不是实现偷懒。

**实际做法**：在既有 `complete()` 面上用**提示协议**完成同一件事 ——
系统提示要求模型把脚本放进带标记的代码块 → 解析出来 → 沙箱执行 → 非零退出时把
真实 `exitCode` + 截断的 `stdout/stderr` 作为下一轮 user 消息回喂 → 上限仍是 **3**。

**行为等价**（写脚本 / 执行 / 失败回喂真实错误 / 上限 3），**机制不同**（提示协议而非
原生 tool call）。签核意图（`confirmed_via` 的第 ③ 点「接受失败回喂重试」）因此满足。

⚠ 读到 §7 时**不要**去找一个叫 `run_script` 的工具定义 —— 它不存在，也不该被重新造出来。
恢复原生工具面是一次跨全部 provider 实现的独立改动，不属于本 delta。
实现与完整推理见 `apps/api/src/application/skill/run-script-with-retries.ts` 头注。

## §4.1 ⚠ 落地修正：经 unix domain socket 通信，不开端口（2026-08-19，coord 已裁定接受）

§4 要求执行不可信脚本的容器 `network: none`，但 `apps/api` 又必须能把请求送进去 ——
这两件事在 TCP 上**直接矛盾**：没有网络接口的容器根本无法被连接。§4 没有写这一层怎么解。

三条出路，采用第三条：

1. 给沙箱容器留网络 ⇒ 直接违反 §4 与 V2-b。**否决**。
2. 服务容器保留网络，每次执行再起一个 `network: none` 的临时容器 ⇒ 必须把 docker socket
   挂进服务，**等同于给它宿主 root**。为收紧网络而放开一个大得多的逃逸面，**净损失。否决**。
3. **容器字面意义上没有网络（`network_mode: "none"`），经共享具名 volume 上的
   unix domain socket 通信。** 无额外特权。← 采用

⚠ 这是**比 §4 更严**的落地形态，不是对它的放宽：沙箱连一个可监听的网络接口都没有。
实现见 `apps/skill-sandbox/src/main.ts` 与 `docker-compose.sandbox.yml` 头注。

## §8 明确不做（防止范围蔓延）

- 不做通用多语言沙箱（Python/LibreOffice 见 §2）。
- 不做沙箱内联网（`network: none` 是边界，不是待放开的开关）。
- 不把试跑产物自动变成项目产物（§5）。
- 不改模型 A/B 收敛结论（`skill-model-a-b-convergence` 已签）。
