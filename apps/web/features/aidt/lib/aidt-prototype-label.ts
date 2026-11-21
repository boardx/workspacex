import type { AidtPrototypeVersionReference } from "./aidt-prototype-versions";

/** Pure presentation helper; no service read or authority claim. */
export function aidtPrototypeVersionLabel(reference: AidtPrototypeVersionReference): string {
  const summary = reference.source === "user" && /^AIDT 图片原型 · [0-9a-f]{64}$/.test(reference.summary)
    ? "图片原型" : reference.summary;
  return `${reference.designName} / v${reference.seq}${summary ? `：${summary}` : ""}`;
}
