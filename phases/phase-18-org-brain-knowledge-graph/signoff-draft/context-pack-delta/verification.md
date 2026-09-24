# 验收口径 · context-pack 通道可用性 + 图路径

- V1：让 AGE 连接失败后跑一次召回，`channelPlan` 中 `graph.available === false`、`hitCount === 0`；回答下方出现「这次没能查全你的记忆」那一行（`kg-channel-down-graph`）。
- V2：经图路召回的条目带 `graphPath`，其中每条边都能在 `ontology_edges` 查到且 `status = active`。
- V3：重放同一 runId，`available` 与 `graphPath` 逐字相同（I-5）。
- V4：反证——把 `available` 固定写成 `true`，V1 当场红。
