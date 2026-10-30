# 后台两轮端到端交接

## 当前已验证

已入库的 [报告](report.md)、[审计汇总](audit-summary.json)、[534条最后结果](latest-audited-cases.json)、[清理核对](cleanup.json) 经 git ls-tree 检查非空。

第一轮517通过/9失败/8既有fixme；第二轮完整覆盖后522/4/8；修复与独立复测后526/0/8，无遗漏计划项、无新增跳过或自动重试。矩阵内部24/24不重复计数。headless Chromium，确定性模型/ASR，真实隔离Web/API/Postgres；设计夹具边界在报告中。

Web等待器11、队列21、API validator37、whiteboard-core完整包298单测通过；Web/API/core typecheck、Web/API lint和首尾init快速检查通过。按ADR-106采用定向/受影响门及PR必需CI，不宣称额外跑过全仓verify:release。

## 本轮改动

PR父链：#6021（图片验收，3c6f77186）→ #6025（消息503等待，0f4189df7）→ #6026（运行中回复贴底，91a093b9d）→ #6024（校验入口与阶段诊断及本报告）。没有执行合并、部署或feature passing修改。

代码动态验收：第二轮业务0f4189df7；白板/聊天聚焦fd242ec09；最后插话验收623a350f7（测试前置改为权威run状态，产品代码相同）。13个关键源码SHA256在source-sha256.json。后续报告/交接提交不改变这些源码。

原始trace含测试会话上下文，未公开上传；入库的是规范化逐条记录、结果/原日志SHA256、命令日志和选定截图。audit.py需要本机私有原始JSON，缺输入时明确拒绝覆盖；新环境只运行validate-evidence.py核对已入库数据。

## 仍损坏或未验证

8条原有fixme未执行；真实模型官方预检缺少DASHSCOPE三个变量，没有退回回环模型冒称真实模型通过。生产网关、真实供应商、生产原生沙箱和真实支付未验收。

#6023保留调查边界：两次5秒worker超时以及偶发授权/消息依赖不可用的底层原因未完全证实。正常探针前后约130ms，不能宣称已消除5秒超时根因。最后白板15/15和聊天失败场景复测通过；新阶段诊断用于以后复现定位。

CI状态是动态事实。当前会话负责将所有必需检查跟到READY_TO_MERGE；下一会话仍须重新查询，不能以此文或旧快照推断现在main状态。未授权自动合并。不要关掉#6023来冒称根因修复。

17个本轮compose project容器与卷均已释放，所属runner无残留。生成tsconfig和旧质量报告已归档恢复。同一worktree复用，未新增worktree。tick因COORD_GATEWAY_URL缺失未接入，未冒用身份。

## 下一步最佳动作

```bash
cd /Users/shenyangjun/.codex/worktrees/548a/workspacex
python3 evidence/e2e-two-round-20261030/validate-evidence.py
pnpm harness pr-queue --pr 6021 --json
pnpm harness pr-queue --pr 6025 --json
pnpm harness pr-queue --pr 6026 --json
pnpm harness pr-queue --pr 6024 --json
```

如收到合并授权，按父链顺序交协调者集成；每次更新基础分支后重查CI。若追查#6023，再用configs中的隔离构建/浏览器命令复现，先核对新日志lastPhase和phaseElapsedMs，保留原5秒/heap/队列，不用增大超时或无限重试代替根因。配置中的绝对路径及/tmp文件应在新环境按实际工作目录重建。
