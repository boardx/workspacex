import { aidtEntitySourceHref } from "@repo/contracts/aidt-stages";
import { AIDT_BRAINSTORM_METHODS, readAidtBrainstorms } from "@repo/contracts/aidt-brainstorm";
import { z } from "zod";
import type { AidtSharedStage } from "./live-aidt-stages";
import { parseAidtPrototypeReference } from "./aidt-prototype-reference";
import { parseAidtResearchMaterial } from "./aidt-research-material-reference";
import { readAidtIdeaDirectory } from "./aidt-idea-handoff";

const entityId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const uuid = z.string().uuid();
const interviewRecord = z.object({ version: z.literal(1), id: uuid, code: z.string().trim().min(1).max(32) });
const transcriptRecord = z.object({ sourceKey: z.string(), locator: z.string().max(120), checked: z.literal(true) });
const definitionRecord = z.object({ id: entityId, confirmed: z.boolean(), archived: z.boolean(), cardIds: z.array(z.string()) });
const personaRecord = definitionRecord.extend({ name: z.string().trim().max(220) });
const hmwRecord = definitionRecord.extend({ text: z.string().trim().max(220) });
const testGroupRecord = z.object({ schemaVersion: z.literal(1), id: uuid, name: z.string().trim().max(80), stage5Revision: z.number().int().positive(), prototypeEntity: entityId.optional() });
const clock = /^(?:(?:\d{1,2}):)?[0-5]?\d:[0-5]\d$/u;

function read<T>(schema: z.ZodType<T>, raw: string | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function sourceHref(stage: AidtSharedStage, id: string, locator?: { sourceId: string; timestamp?: string }) {
  const href = aidtEntitySourceHref(stage.projectId,stage.stageId,id,stage.revision);
  if (!locator) return href;
  const extra = new URLSearchParams({sourceId:locator.sourceId,...(locator.timestamp ? {timestamp:locator.timestamp} : {})});
  return href + "&" + extra;
}

/** Enumerate records actually present in the selected authorized revision.
 * A stage receipt alone does not assert any specific record was used in the prose. */
export function aidtReportSourceLinks(stage: AidtSharedStage): { id: string; title: string; href: string }[] {
  const { fields, ideas } = stage.content.draft;
  if (stage.stageId === 4) {
    const counts = new Map<string, number>();
    for (const idea of ideas) counts.set(idea.id, (counts.get(idea.id) ?? 0) + 1);
    return [
      ...readAidtBrainstorms(fields).map(session => ({ id: session.id, title: `头脑风暴 · ${AIDT_BRAINSTORM_METHODS[session.method]}`, href: sourceHref(stage, session.id) })),
      ...readAidtIdeaDirectory(stage.content.draft).flatMap(idea => entityId.safeParse(idea.id).success && counts.get(idea.id) === 1
        ? [{ id: idea.id, title: idea.title.trim() || "未命名点子", href: sourceHref(stage, idea.id) }]
        : []),
    ];
  }

  const links = new Map<string, { id: string; title: string; href: string } | null>();
  const add = (id: string, title: string, locator?: { sourceId: string; timestamp?: string }) => {
    if (!entityId.safeParse(id).success) return;
    links.set(id, links.has(id) ? null : { id, title, href: sourceHref(stage, id, locator) });
  };
  for (const [key, value] of Object.entries(fields)) {
    if (stage.stageId === 1 && key.startsWith("problemEntity:")) {
      const record = read(z.object({ id: uuid, title: z.string().trim().min(1).max(120) }), value);
      if (record && key === `problemEntity:${record.id}`) add(record.id, record.title);
    }
    if (stage.stageId === 2 && key.startsWith("interviewRecord:")) {
      const record = read(interviewRecord, value);
      if (!record || key !== `interviewRecord:${record.id}`) continue;
      const transcript = read(transcriptRecord, fields[`interviewTranscript:${record.id}`]);
      const material = transcript?.sourceKey.startsWith(`interviewMaterial:${record.id}:`)
        ? parseAidtResearchMaterial(fields[transcript.sourceKey]) : null;
      const locator = material?.projectId === stage.projectId ? {
        sourceId: material.artifactId,
        timestamp: transcript && clock.test(transcript.locator) ? transcript.locator : undefined,
      } : undefined;
      add(record.id, record.code, locator);
    }
    if (stage.stageId === 3 && key.startsWith("definitionPersona:")) {
      const record = read(personaRecord, value);
      if (record && key === `definitionPersona:${record.id}`) add(record.id, record.name || "未命名画像");
    }
    if (stage.stageId === 3 && key.startsWith("definitionHmw:")) {
      const record = read(hmwRecord, value);
      if (record && key === `definitionHmw:${record.id}`) add(record.id, record.text || "未命名 HMW");
    }
    if (stage.stageId === 5 && key.startsWith("prototypeEntity:")) {
      const id = key.slice("prototypeEntity:".length);
      const record = read(z.record(z.string()), value);
      const reference = parseAidtPrototypeReference(record?.prototypeReference);
      if (reference?.designId === id) add(id, reference.designName || "原型");
    }
    if (stage.stageId === 6 && key.startsWith("testGroup:")) {
      const record = read(testGroupRecord, value);
      if (record && key === `testGroup:${record.id}`) {
        const title = record.name || "测试组";
        add(record.id, title);
        if (record.prototypeEntity) {
          const linkId = `${record.id}:prototype`;
          links.set(linkId, { id: linkId, title: `${title} · 被测原型 V${record.stage5Revision}`,
            href: sourceHref({ ...stage, stageId: 5, revision: record.stage5Revision }, record.prototypeEntity) });
        }
      }
    }
  }
  return [...links.values()].filter(link => link !== null);
}
