/**
 * 用户消息里的回环测试控制标记（`[request_handoff:D003]`、`[escalate:…]`、
 * `[start_workflow:…]`、`[evidence:…]`）——裁决：这是 loopback 模型的测试开关，不是给人看的。
 * 这里只做**显示层**剥离；存储的消息原文一字不改（复制/编辑/记忆抽取仍用原文）。
 */
const CONTROL_MARKER = /\s*\[(?:request_handoff|escalate|start_workflow|evidence):[^\]\n]*\]/g;

export function stripControlMarkersForDisplay(text: string): string {
  const stripped = text.replace(CONTROL_MARKER, "");
  return stripped === text ? text : stripped.trim();
}
