# 候选原因类别表（步骤 4）

按 profile 选类别表；每个候选原因必须挂到至少一个 IS/IS NOT 差异或变化上，挂不上的进 `discardedCandidates`。

| profile | 类别 |
|---|---|
| `incident` | 变更、容量、依赖、配置、监控/告警、流程 |
| `process-deviation`（6M） | 人员角色、机器、材料、方法、测量、环境 |
| `customer-issue` | 产品缺陷、配置/使用、数据、沟通/预期、政策、第三方 |

直接调用的角色只在 profile 缺省值和方法侧重上有差异：D012/D050 → process-deviation（偏重价值流/等待浪费类原因）；D013/D036 → process-deviation 并要求 `dataChecks`；D019/D028 → incident（设备/资产失效，偏重物理失效机理与维护记录）。
