import type { PrototypeNode } from "@repo/contracts/design-prototype";
import { loadAidtPrototypeSnapshot, type AidtPrototypeReadContext } from "./aidt-prototype-versions";
import { readAidtStageRevision } from "./live-aidt-stages";
import { isAidtPrototypeHandoffConfirmed, readAidtPrototypeEntityDraft } from "./aidt-prototype-handoff";
import { createAidtQuestionSnapshot } from "./aidt-verification-loop";
import type { AidtTestGroup } from "./aidt-test-groups";

export async function loadAidtTestResearchContext(context: AidtPrototypeReadContext, group: Pick<AidtTestGroup, "stage5Revision" | "designId" | "versionId" | "prototypeEntity">) {
  const stage = await readAidtStageRevision(context.projectId, 5, group.stage5Revision, context.sessionToken, context.signal);
  const source = stage && (group.prototypeEntity ? readAidtPrototypeEntityDraft(stage.content.draft, group.prototypeEntity) : stage.content.draft);
  const bound = source && (!group.prototypeEntity || isAidtPrototypeHandoffConfirmed(source)) && createAidtQuestionSnapshot(source, group.stage5Revision);
  if (!bound || !bound.ok || bound.snapshot.prototypeDesignId !== group.designId || bound.snapshot.prototypeVersionId !== group.versionId) throw new Error("AIDT_TEST_SOURCE_MISMATCH");
  const snapshot = await loadAidtPrototypeSnapshot(context, group.designId, group.versionId, "linked-reader");
  return { snapshot, question: bound.snapshot, text: [`原验证问题：${bound.snapshot.question}`, `测试前看法：${bound.snapshot.beforeTestBelief || "尚未记录"}`, `验证范围：${bound.snapshot.verificationLimits || "尚未记录"}`, aidtTestPrototypeText(snapshot)].join("\n") };
}

/** Bounded excerpt of actual persisted text, not an interpretation of image pixels. */
export function aidtTestPrototypeText(snapshot: Awaited<ReturnType<typeof loadAidtPrototypeSnapshot>>) {
  const lines = [`原型精确版本：${snapshot.id}`, `版本说明：${snapshot.summary || "未记录"}`];
  let visited = 0, omitted = false;
  function append(node: PrototypeNode | null) {
    if (!node) return;
    if (++visited > 200) { omitted = true; return; }
    const values = new Map<string, unknown>("props" in node && node.props ? Object.entries(node.props) : []);
    const text = ["text", "label", "placeholder", "title", "subtitle", "alt", "caption", "value"].flatMap(key => {
      const value = values.get(key); return typeof value === "string" && value.trim() && !value.startsWith("data:") ? [`${key}=${value.slice(0, 300)}`] : [];
    });
    lines.push(`${node.type}${text.length ? "：" + text.join("；") : "（无可用文字）"}`);
    if ("children" in node) node.children.forEach(append);
  }
  snapshot.frames.forEach((name, index) => {
    lines.push(`页面 ${index + 1}：${name}`, `已有交互说明：${snapshot.notes[index] || "未记录"}`);
    append(snapshot.prototype[index] ?? null);
  });
  const body = lines.join("\n");
  return `${body.slice(0, 6000)}${omitted || body.length > 6000 ? "\n（结构或文字摘录已截断，完整版本仍在原生原型中。）" : ""}\n以上仅含已保存结构和文字，不含图像像素或完整 HTML；不能据此声称已理解视觉与交互效果。`;
}
