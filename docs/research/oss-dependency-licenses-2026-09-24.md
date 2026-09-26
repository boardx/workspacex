# 依赖许可证盘点实跑（2026-09-24）

> backlog B1 + B2。十轮迭代第 5 轮。
> 工具：`.harness/scripts/oss-dependency-inventory.mjs --registry`，本轮修了它的三个 bug 之后跑出的结果。
> **本文只陈述事实，不做法律结论**——每一条「需确认」最终要人（或法务）拍板。

## 结论先行

| | 数量 |
|---|---|
| lockfile 里的第三方包 | 2163 |
| 解析到许可证 | **2162**（本机 1867 · LICENSE 正文 16 · npm registry 279） |
| 仍未解析 | **1**：`buffers@0.1.1`，**随产品分发** |
| 随产品分发的包（生产依赖闭包，上界） | 1263 |
| 需人工确认（弱 / 强 copyleft 等） | 37，其中**随产品分发 2** |

**没有发现强 copyleft（GPL / AGPL）进入随产品分发的闭包。** 需要人看的只有三件事，见最后一节。

## 盘点工具原来有三个 bug

初版结论是「装了依赖再跑就完整了」。这次装着依赖实跑，发现那个前提不成立：

| bug | 表现 | 修法 |
|---|---|---|
| **只读根目录 `node_modules/<名字>`**，且**不看版本** | 装着依赖也只解析出 **42 / 2163**；解析出来的还可能是另一个版本的许可证 | 按 `名字@版本` 精确查 pnpm 的 `.pnpm` 存储；根目录那份版本不符就不采信 |
| **需确认名单只匹配开头** | `LGPL-3.0-or-later`（不以 GPL 开头）、`MPL-2.0`、`Apache-2.0 AND LGPL-3.0-or-later` 全部漏过，报「0 个需确认」 | 补入弱 copyleft；复合表达式按 SPDX 语义拆开（OR 任选其一、AND 必须同时满足） |
| **不分生产与开发依赖** | 测试工具、构建工具的许可证与真正交付给客户的混在一起 | 从产品侧各项目的生产依赖出发，沿 lockfile 展开闭包；排除仓库根（harness 工具链）与运营平面 |

另外两处补强：`package.json` 没写 `license` 字段但包里带 LICENSE 文件的，按正文认常见许可证（16 个，含 `@ag-ui/*`、`@copilotkit/*`）；
本机没装的包（240 个是 Windows / macOS / OpenHarmony 的平台专属二进制，桌面版会随别的平台发出去）可选 `--registry` 按确切版本查 npm。
`--registry` 默认关，门控仍能离线跑。

运营平面名单原本写在 R3 的生产依赖门控里；本轮这里也要用，于是抽到 `lib/ops-plane.mjs` 成为唯一一份，两个脚本共用。

## 「随产品分发」是上界，不是精确值

闭包按 lockfile 的**生产依赖**算。实际打进产物的是它的子集——例如 Next.js 只打包真正被 import 的文件。
所以这里说「在闭包里」意味着**可能**被分发，说「不在闭包里」才是确定不分发。

## 许可证分布（全部 2163 个）

| 许可证 | 数量 |
|---|---|
| MIT | 1699 |
| Apache-2.0 | 157 |
| ISC | 137 |
| BSD-3-Clause / BSD-2-Clause | 36 / 21 |
| LGPL-3.0-or-later（含与 Apache 的 AND 组合） | 28 |
| BlueOak-1.0.0 | 12 |
| MPL-2.0 | 9 |
| 其他宽松许可（OFL、Unlicense、CC0、0BSD、MIT-0、WTFPL、Python-2.0 等） | 其余 |

## 需人工确认的：随产品分发 2 个

| 包 | 许可证 | 怎么进来的 |
|---|---|---|
| `@edge-runtime/primitives@4.1.0` | MPL-2.0 | 见下 |
| `@edge-runtime/vm@3.2.0` | MPL-2.0 | `apps/web → @copilotkit/runtime → @copilotkit/channels-core@0.8.1 → vitest@2.1.9 → …` |

**这是上游的打包错误**：`@copilotkit/channels-core@0.8.1` 把测试框架 **vitest 写进了生产依赖**，于是 vitest 连同它的 MPL 依赖进了 web 的生产闭包。
MPL-2.0 是文件级 copyleft：原样分发未修改的文件只需保留声明、提供源码获取途径（npm 上即有）。大概率不是阻断项，但它本不该在那里。

## 需人工确认的：不随产品分发 35 个

- **`@img/sharp-libvips-*`（LGPL-3.0-or-later，各平台共 28 个）**：sharp 的 libvips 预编译二进制。只被开发工具链拉进来；Next.js 14 不依赖 sharp。**确定不在分发闭包里。**
- **`axe-core`、`@axe-core/playwright`（MPL-2.0）**：无障碍测试工具，开发依赖。
- **`@edge-runtime/*` 其余几个与 `edge-runtime`（MPL-2.0）**：开发工具链。

不分发就不构成再分发义务。列出来是为了说明它们**被看过了**，而不是被漏过。

## B2：`@firecrawl/anydoc` 定性

被 `apps/api` 与 `apps/skill-sandbox` 直接依赖（`0.1.8`，锁定版本）。

- 声明 **MIT**；主包是 JS 外壳，真正干活的是按平台分发的原生二进制（`@firecrawl/anydoc-<平台>`，linux-x64 那个 8.3 MB），同样声明 MIT
- 原生二进制是静态链接的，**它内部链进了哪些库、各是什么许可，npm 元数据不会告诉你**
- 对二进制做了字符串扫描，没有发现 GPL / AGPL / MuPDF 等标记——**这是弱证据**：没搜到标记不等于没有那个许可证

**要得到确定结论，需要看上游构建的依赖清单**（它来自 `github.com/firecrawl/anydoc`）。这一步从 npm 元数据做不到，留给人。

## 留给人的三件事

1. **`buffers@0.1.1` 随产品分发，却在任何地方都没声明许可证**（经 `binary@0.3.0` 进来）。要么确认其许可，要么换掉引入它的那条依赖链。
2. **`@firecrawl/anydoc` 原生二进制里静态链接了什么**，需要上游依赖清单才能定。
3. **`@copilotkit/channels-core` 把 vitest 写进生产依赖**——可以向上游报告；在它修之前，web 的生产闭包里会多出一批测试工具。

以及一个前提：**许可证结论以 D1（我们自己用什么许可证开源）为准。** 上面这些都是「我们能不能合法再分发别人的东西」，D1 是「别人能怎么用我们的东西」，两件事不能互相代替。
