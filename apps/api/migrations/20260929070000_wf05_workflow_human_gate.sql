/*
 * WF05（Phase 20 work-stack-foundation）—— 人工门 I-17 的库内兜底。
 *
 * 门的事实只在 workflow_events 里（gate_opened / gate_decided，见 application/workflow/human-gate-state.ts）。
 * 应用层用 expectedStateVersion 的 CAS 保证两人同时审批只有一个成功；这里再加一道唯一索引：
 * 每个 (instance_id, gateId) 至多一条 gate_decided——就算绕过应用层也写不进第二个决定（「gate 决定不可撤销」）。
 */
CREATE UNIQUE INDEX IF NOT EXISTS workflow_events_gate_decided_once
  ON workflow_events (instance_id, (data->>'gateId'))
  WHERE type = 'gate_decided';
