import type { AidtPrototypeVersionReference } from "./aidt-prototype-versions";

/** Pure presentation helper; no service read or authority claim. */
export function aidtPrototypeVersionLabel(reference: AidtPrototypeVersionReference): string {
  return `${reference.designName} / v${reference.seq}${reference.summary ? `：${reference.summary}` : ""}`;
}
