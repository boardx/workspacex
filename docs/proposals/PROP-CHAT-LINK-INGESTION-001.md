# 链接 ingestion 评估（一页）（PROP-CHAT-LINK-INGESTION-001）

> **状态：评估，不实现**（coord-main W2 边界：只出一页评估）。人类提「附件的链接的解决方案」——
> 用户给一个 URL，把网页内容读进 context。**anydoc 不做 URL 抓取**（它只转本地文件字节），所以这是
> 独立于 anydoc（W1）的一块。coord-main 裁选型，不找人类。

## 为什么和 anydoc 分开
`@firecrawl/anydoc` 的 API（`toMarkdownBytes`/`toMarkdown`）只吃**本地文件字节/路径**，
不发网络请求、不抓 URL。硬把 URL 塞给它没有意义。链接 ingestion = **抓取（网络）+ 清洗 → markdown**，
是另一条链路。

## 候选方案

| 方案 | 是什么 | 优 | 劣 / 风险 |
|---|---|---|---|
| **A. 复用 open-deep-research 的网页读取** | 本仓 RoutingModelCallPort 已注册 `open-deep-research` provider，它的执行路径里**已经有**网页读取能力（deep-research 天生要读网页） | 零新依赖、已在生产跑、已过部署面 | 需核实它的网页读取是否可**单独调用**（还是只在 deep-research 编排内部）；抓取质量/清洗格式未知 |
| **B. 自托管抓取器**（如 readability/trafilatura 类，或 Firecrawl 自托管开源版） | 独立的「URL → 干净正文 markdown」服务/库 | 可控、可自托管（符合「不引入云服务」） | 新依赖/新服务；SSRF 安全面（用户给的 URL 不能让服务器去打内网——必须白名单/黑名单 + 禁私网段）；反爬/JS 渲染页读不全 |
| **C. Firecrawl 云 API** | 上游 firecrawl 的托管抓取 | 质量最好、省事 | **违反 coord-main「不引入云服务/不需 API key」的前提** → 否决 |

## 硬约束（无论选哪个）
- **SSRF**：用户提交的 URL 由**服务器**去抓 = 经典 SSRF 面。必须禁止私网段（127/10/172.16-31/192.168/
  169.254 等）、禁止非 http(s)、禁止重定向到内网、加超时和大小上限。这条不做，这个功能就是个漏洞。
- **进 context 走同一条 L3 路径**：抓回的 markdown 和 anydoc 转出的 markdown 一样，进 context engine
  的 L3 检索层（不整篇塞 ModelCallInput）。`ModelCallPort` 契约不动。
- **不做假 UI**：没有真实抓取后端前，输入框不加「粘贴链接」的假入口（本仓红线）。

## 推荐
**先查 A 的可复用性**（open-deep-research 的网页读取能否单独调用）——若可行，零新依赖、零新服务面，
是最省的路径；若它耦合在 deep-research 编排内部拿不出来，再评 B（自托管抓取器 + 严格 SSRF 防护）。
C 直接否决。

## 需要 coord-main 裁
1. A 的网页读取是否可单独调用？（需要看 open-deep-research provider / deep-agent-service 的接口）——
   这决定走 A 还是 B。
2. 链接 ingestion 的优先级：它在 V9-b（文件转换）之后还是并列？人类同时提了「文件上传」和
   「附件的链接」，但文件是已签核主线，链接是新增面。

---

*本文档由 dev-chat-e2e worker 2026-08-11 整理，一页评估、不实现，待 coord-main 裁选型。*
