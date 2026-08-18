---
status: pending           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
bundle: skill-sandbox-execution
base_bundle: skill-trial-run
scope: trial-run-executes-model-written-scripts-in-a-network-isolated-container-and-produces-real-artifacts
covers: [F204]
confirmed_by:
confirmed_at:
confirmed_via:
---

# design delta 签核 · 试跑接真执行（沙箱化脚本执行 + 真实产物）

⚠ `status` 只能由**人类**改。agent 不许动这一行（ADR-023）。

规范唯一来源：本目录下的 [`contract.md`](./contract.md)。
验收口径：[`verification.md`](./verification.md)。

## 这份 delta 为什么存在

人类 2026-08-18 追问「试跑的结果，看到了 pptx 的文件结果吗？」——答案是**没有**。
#1570 记录了根因：试跑是**单轮 completion，没有工具执行、没有沙箱**，结构上产不出文件。
实测铁证：真实模型的回复里出现了字面 `<tool_call>` 块，说明它在尝试调用拿不到的工具。

人类就此裁决走 **(b) 真执行**，并要求「选一个聪明的办法，可以跑通」。

本 delta 是那条路径的设计。**动工前已做 spike 验证（#1575），不是纸上方案**：
真实模型 + 真实执行已经产出了一个 64KB、3 页、OOXML 合法、内容与需求逐条对应的 .pptx。

## 签核前请重点确认

- [ ] **① 这是一个安全边界扩大的决定，需要你明确批准，不是技术细节**
      执行模型生成的代码，等于让"从 GitHub 导入的 skill"间接获得在我们基础设施上
      跑代码的能力。contract §4 给的是我能构造的最强边界（容器 `network: none`
      + Node 权限模型两层，各挡各的）。但"允许这件事发生"本身是产品/风险取舍，
      按本仓纪律不由 agent 默认决定。**这一条不批，整个 delta 不成立。**

- [ ] **② 首个切片只做"从零创建 deck"，不做编辑存量/转旧格式/视觉 QA**
      依据（#1575 ①）：pptx skill 的决策表里，只有 Create 这一行是纯 `pptxgenjs`（Node）；
      编辑存量 deck、转 `.ppt`、视觉 QA 分别要 `python-pptx`、LibreOffice、Poppler。
      把后三者一起做进首个切片会让镜像与范围膨胀数倍。确认先只做 Create。

- [ ] **③ 失败回喂重试是必需的，不是优化**
      实测（#1575 ②）：一次性生成**第 1 次就失败**（`pres.ShapeType` 在 pptxgenjs v4
      不存在），把 stderr 回喂后**第 2 次收敛**。确认接受"最多 N 次重试"这个形态，
      以及它带来的 token/时延成本（实测两轮共约 15k tokens）。

- [ ] **④ 时延与同步/异步**
      实测单轮真实模型调用（20KB system prompt）本身就要 33.5s（关思考）到 200-300s（开思考），
      再叠加重试与执行 ⇒ **必然超过 R9「>10s 转异步任务」的线**。contract §6 提议试跑
      改走既有 `AgentRun` 那套"提交 → 轮询"的异步形态，而不是继续占着一条同步 HTTP。
      确认这个改动（它会改动试跑的 API 契约形状）。

- [ ] **⑤ 产物落在哪、算不算"产物"**
      contract §5 提议：沙箱产出的文件经 `ObjectStore.putOnce` 落库，试跑结果里回一个
      可下载引用。**但不自动落成项目产物（artifact）**——试跑是"预演"，自动往项目里
      塞文件是另一个语义。确认这条边界。

## 与既有已签内容的关系

- **不改** `skill-trial-run` 已签的授权口径（组织成员即可试跑）与错误码集合，只在其上
  增加执行能力与异步形态（contract §6 列出契约层的具体增量）。
- **形态复用** `apps/deep-agent-service`（#739/#740）：独立服务 + 自己的容器 + HTTP 契约
  + 测试用 loopback 替身。不新造第二套服务治理方式。
- **不动** `skill-model-a-b-convergence` 已签的模型 A 单一权威结论。
