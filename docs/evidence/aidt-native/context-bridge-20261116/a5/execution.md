# A5 原生运行冻结上下文：执行与派发

本轮依据用户会话明确批准的bridge范围实施；未替人修改设计签核状态。以下验证不启动产品栈、不调用供应商模型、不提交或部署。普通Chat回归与新增AIDT反例分别由实际端口测试覆盖。

```mermaid
flowchart LR
  A[核对批准边界及各路ports] --> B[Claim仅携带真实Guarded快照]
  B --> C[真实resolve授权后组装冻结参考块]
  C --> D[实际序列化与派发观察]
  D --> E[170项无费用回归及定向类型]
  E --> F[Root DI与A6真实PG跨层验收]
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  class A done
  class B,C,D,E tested
  class F doing
```

## 实际实现

- `ClaimedAgentRun`新增仅AIDT使用的selector hash marker及`Guarded<AidtStoredContextSnapshot>`。`PgAgentRunRepository`第三可选参数为snapshot reader，marker为空不读快照；应有快照却缺reader/记录、损坏的存储读、跨project guard均不可执行。Claim不展开学生正文。
- `ExecuteAgentRunDeps.aidtContexts`使用A2的`resolve/revalidate/append`。生产`resolve`必须走实际权限决定和disclose；执行层随后核org/run/project/thread/input message/requester、canonical selector/snapshot hash、冻结block hash和准确单一focus pin，不把旧快照当当前授权。无selector路径不调用这些端口。
- 独立不可信参考消息只使用准备时冻结的`modelReferenceBlock`，不重新选择head或剪裁；插入点在L1/L2、检索与记忆之后、`assembleAttachmentContext`之前。没有伪造chat message ID，不作为已验证研究来源；保留既有root来源索引。人类持久正文及原有user/system组装行为不拼改。
- `ModelCallInput.referenceDispatchObserver`为通用可选内部口，无AIDT反向依赖。DeepAgent核对**实际序列化messages**的准确history slot、内容SHA256及最终UTF8消息字节数（包括native message id），授权复验通过后才POST；成功返回真实remote run/thread ID后才观察派发。128KiB上限与prepare预留1024字节配合，执行端不偷偷剪裁冻结块。
- HITL及checkpoint恢复只发送原有command，不重发输入或新参考块；仅记录checkpoint恢复，由store从真实既有journal派生原始派发关联。Configured直连路径检查实际history并复验权限，v1不冒称native服务派发。
- 应用日志为仅AIDT的独立append-only表。日志写入失败保持缺口，不把已受理远端任务重发。内核不可用或模型请求失败记录一次封闭失败事实；已观察到的真实派发不因此被改称未派发。
- `AgentRunExecutor`在原`aiAdmission`之后新增可选末参数`aidtContexts`，普通tick与carry-over的两处执行依赖均透传。Root独占kernel DI。

## 本轮文件

生产：`application/agent-run/{ports,aidt-context-reference,reference-dispatch,execute-run}.ts`；`infrastructure/agent-run/{pg-agent-run-repository,agent-run-executor,deep-agent-model-provider,configured-model-provider}.ts`。

测试与配置：新增reference-dispatch、aidt-context-reference/execute/claim/provider五份测试，新增共享已解析快照夹具，补Configured thinking套件三条参考消息反例；独立unit配置只纳入内存/本机录制HTTP测试，未跳过真实PG测试的隔离要求。A6拥有实际录制transport及真实PG集成。

## 实际验证

- `pnpm exec vitest run --config vitest.aidt-context-execute.config.ts`：10文件 **170/170**，含既有executor42、DeepAgent19、HITL19、Configured stream20及thinking21等兼容测试。[完整日志](core-tests.txt)
- `pnpm exec tsc -p tsconfig.aidt-context-execute.json`：退出0。[类型日志](core-types.txt)
- API实际使用的error-leak、architecture、permission三门均退出0，且记录实际扫描数量：[响应边界](error-leak.txt)、[分层](architecture.txt)、[权限路径](permissions.txt)。
- 指定文件`git diff --check`退出0。
- API根未配置可用ESLint入口，尝试该命令因缺少root ESLint模块而未执行；未冒称ESLint通过，也未安装依赖或修改全局ignore。采用仓库API现有custom lint。

新增反例包括：应有快照/执行端口缺失、六种错误坐标、selector/snapshot/block摘要篡改、focus重新并入无关catalog、最终消息含native metadata的UTF8超限、JSONB对象键重排、派发邻近撤权、journal故障不重复任务、transport拒绝不伪派发、同remote thread恢复command不重发、普通Chat零AIDT I/O，以及精确原文和未知来源参考块保留。

## 证据边界

纯逻辑/执行测试中的resolve为明确受控端口，仅证明接线和拒绝路径，不证明A2权限实现。Claim使用真实`guard()`保持正文隐藏；实际授权/disclose、RLS、事务、持久化及重启回读由A6真实PG场景另外验证，不能用本170项替代。

录制HTTP测试使用实际DeepAgent/Configured适配器和本机随机端口，不mock fetch、不访问模型供应商；只证明native request body及回执时序，不证明Python检查点引擎或完整供应商prompt、子模型继承、建议质量或课堂效果。之前Design V1/V2的真实生成证据属于另一专项，未借其冒称本bridge实模验收。
