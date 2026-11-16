import { AIDT_STAGE_IDENTITIES, AIDT_SUMMARY_STABLE_NAME, AidtContextSelector, AidtContextReceipt, aidtContextSelectorJson } from "@repo/contracts/aidt-run-context";

/** QA expectation from independently GET-read server rows, without importing the business selector builder. */
export function expectedAidtV2StageSelector(projectId: string, stageId: number, saved: readonly ({ projectId: string; stageId: number; revision: number; sourceStageRevisions: readonly { stageId: number; revision: number }[] } | null)[], returnRevision?: number) {
  const rows = saved.filter((row): row is NonNullable<typeof row> => row !== null);
  if (rows.some(row => row.projectId !== projectId) || new Set(rows.map(row => row.stageId)).size !== rows.length) throw new Error("AIDT_QA_SAVED_SOURCE_SCOPE_MISMATCH");
  const refs = new Map(rows.filter(row => row.stageId <= stageId).map(row => [row.stageId, { stageId: row.stageId, revision: row.revision }]));
  for (const source of rows.find(row => row.stageId === stageId)?.sourceStageRevisions ?? []) {
    if (source.stageId >= stageId) throw new Error("AIDT_QA_SAVED_SOURCE_STAGE_MISMATCH");
    refs.set(source.stageId, { ...source });
  }
  return AidtContextSelector.parse({ schemaVersion: 1, projectId, purpose: "stage", stageId, stageRevisions: [...refs.values()].sort((a, b) => a.stageId - b.stageId), ...(returnRevision !== undefined ? { returnRevision } : {}) });
}

/** Validate coordinates-only teaching input; safe metadata never substitutes for a server receipt. */
export function aidtV2WireMetadata(body: unknown, markers: readonly { stageId: number; field: string; marker: string }[], skillName: string, expected?: AidtContextSelector, authoredStudentTexts: readonly string[] = []) {
  const root = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const forwarded = root.forwardedProps && typeof root.forwardedProps === "object" ? root.forwardedProps as Record<string, unknown> : {};
  const selector = AidtContextSelector.parse(forwarded.aidtContext);
  const stage = AIDT_STAGE_IDENTITIES.find(item => item.skill === skillName);
  if (skillName === AIDT_SUMMARY_STABLE_NAME ? selector.purpose !== "summary" : !stage || selector.purpose !== "stage" || selector.stageId !== stage.id) throw new Error("AIDT_QA_WIRE_TASK_MISMATCH");
  if (expected && aidtContextSelectorJson(selector) !== aidtContextSelectorJson(expected)) throw new Error("AIDT_QA_WIRE_COORDINATES_MISMATCH");
  const authoredPaths = new Set<string>();
  if (Array.isArray(root.messages)) root.messages.forEach((message, index) => {
    if (!message || typeof message !== "object") return;
    const row = message as Record<string, unknown>;
    if (row.role !== "user" && row.role !== "human") return;
    if (typeof row.content === "string" && authoredStudentTexts.includes(row.content)) authoredPaths.add(`$.messages[${index}].content`);
    if (Array.isArray(row.content)) {
      const parts = row.content as { type?: unknown; text?: unknown }[];
      const text = parts.filter(part => part.type === "text" && typeof part.text === "string").map(part => part.text).join("");
      if (authoredStudentTexts.includes(text)) parts.forEach((part, partIndex) => { if (part.type === "text" && typeof part.text === "string") authoredPaths.add(`$.messages[${index}].content[${partIndex}].text`); });
    }
  });
  const strings: { path: string; value: string }[] = [];
  const collect = (value: unknown, path: string, depth: number): void => {
    if (depth > 100) throw new Error("AIDT_QA_WIRE_DEPTH_UNAVAILABLE");
    if (typeof value === "string") strings.push({ path, value });
    else if (Array.isArray(value)) value.forEach((child, index) => collect(child, `${path}[${index}]`, depth + 1));
    else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) collect(child, `${path}.${key}`, depth + 1);
  };
  collect(root, "$", 0);
  const messages = Array.isArray(root.messages) ? root.messages.map((message, index) => {
    const row = message && typeof message === "object" ? message as Record<string, unknown> : {};
    const leaf = strings.filter(value => value.path.startsWith(`$.messages[${index}].`));
    return { index, role: typeof row.role === "string" ? row.role : null,
      hasSavedMarker: leaf.some(value => markers.some(marker => value.value.includes(marker.marker))),
      mentionsMountedSkill: leaf.some(value => value.value.includes(skillName)) };
  }) : [];
  const context = Array.isArray(root.context) ? root.context.map((value, index) => {
    const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const description = typeof row.description === "string" ? row.description : "";
    return { index, descriptionIsAidt: /AIDT|六步|小组|教学/.test(description),
      // Descriptions are not needed verbatim to establish the bridge shape.
      descriptionLength: description.length,
      hasSavedMarker: strings.filter(leaf => leaf.path.startsWith(`$.context[${index}].`)).some(leaf => markers.some(marker => leaf.value.includes(marker.marker))) };
  }) : [];
  if (strings.some(leaf => !authoredPaths.has(leaf.path) && markers.some(source => source.marker && (leaf.value.includes(source.marker) || leaf.value.includes(JSON.stringify(source.marker).slice(1, -1)))))) throw new Error("AIDT_QA_BROWSER_MATERIAL_BODY_LEAK");
  return { selectorCoordinates: selector, coordinatesOnly: true, topLevelKeys: Object.keys(root).sort(), messages, context,
    savedMarkerLocations: markers.map(marker => ({ stageId: marker.stageId, field: marker.field,
      locations: strings.filter(leaf => leaf.value.includes(marker.marker)).map(leaf => leaf.path) })),
    mountedSkillLocations: strings.filter(leaf => leaf.value.includes(skillName)).map(leaf => leaf.path),
    rawValuesRetained: false };
}

/** Independent GET data, exact frozen coordinates/pin/hash, and actual dispatch or inherited same-run resume. */
export function validateAidtV2Receipt(raw: unknown, expected: { selector: AidtContextSelector; runId: string; skillVersionId: string; snapshotHash?: string; requireDispatch?: boolean; originalDispatchAttemptId?: string }) {
  const receipt = AidtContextReceipt.parse(raw), selector = AidtContextSelector.parse(expected.selector);
  const actual = AidtContextSelector.parse({ schemaVersion: 1, projectId: receipt.projectId, purpose: receipt.purpose, stageRevisions: receipt.stageRevisions,
    ...(receipt.purpose === "stage" ? { stageId: receipt.stageId, ...(receipt.returnRevision !== undefined ? { returnRevision: receipt.returnRevision } : {}) } : { historyRevisions: receipt.historyRevisions }) });
  if (receipt.runId !== expected.runId || receipt.skillVersionId !== expected.skillVersionId || aidtContextSelectorJson(actual) !== aidtContextSelectorJson(selector)
    || (receipt.purpose === "stage" && receipt.historyRevisions.length) || (expected.snapshotHash && receipt.snapshotHash !== expected.snapshotHash)) throw new Error("AIDT_QA_RECEIPT_SCOPE_OR_SNAPSHOT_MISMATCH");
  const state = receipt.application;
  if (expected.requireDispatch !== false) {
    const sameRunAttempt = (id: string | null) => !!id && id.startsWith(`${expected.runId}:`) && /^(0|[1-9]\d*)$/.test(id.slice(expected.runId.length + 1)) && Number.isSafeInteger(Number(id.slice(expected.runId.length + 1)));
    if (!sameRunAttempt(state.attemptId) || !state.assembledContextHash) throw new Error("AIDT_QA_RECEIPT_DISPATCH_NOT_PROVEN");
    if (state.state === "message-dispatch-observed") {
      if (!state.assembledAt || !state.messageDispatchedAt) throw new Error("AIDT_QA_RECEIPT_DISPATCH_NOT_PROVEN");
    } else if (state.state === "checkpoint-resume-observed") {
      if (!state.checkpointResumedAt || !sameRunAttempt(state.inheritedMessageDispatchAttemptId) || (expected.originalDispatchAttemptId && state.inheritedMessageDispatchAttemptId !== expected.originalDispatchAttemptId)) throw new Error("AIDT_QA_RECEIPT_RESUME_NOT_INHERITED");
    } else throw new Error("AIDT_QA_RECEIPT_DISPATCH_NOT_PROVEN");
  }
  return receipt;
}
