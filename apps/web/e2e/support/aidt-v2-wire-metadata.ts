/** Retain request shape and boolean marker locations, never prompt bodies, bearer or context values. */
export function aidtV2WireMetadata(body: unknown, markers: readonly { stageId: number; field: string; marker: string }[], skillName: string) {
  const root = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const strings: { path: string; value: string }[] = [];
  const collect = (value: unknown, path: string, depth: number): void => {
    if (depth > 15) return;
    if (typeof value === "string") strings.push({ path, value });
    else if (Array.isArray(value)) value.slice(0, 500).forEach((child, index) => collect(child, `${path}[${index}]`, depth + 1));
    else if (value && typeof value === "object") for (const [key, child] of Object.entries(value).slice(0, 500)) collect(child, `${path}.${key}`, depth + 1);
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
  return { topLevelKeys: Object.keys(root).sort(), messages, context,
    savedMarkerLocations: markers.map(marker => ({ stageId: marker.stageId, field: marker.field,
      locations: strings.filter(leaf => leaf.value.includes(marker.marker)).map(leaf => leaf.path) })),
    mountedSkillLocations: strings.filter(leaf => leaf.value.includes(skillName)).map(leaf => leaf.path),
    rawValuesRetained: false };
}
