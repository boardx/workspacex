import { research as C } from "@repo/contracts";

/** Project live prose into the public legacy chapter envelope. Internal binding
 * IDs and raw model JSON never cross the stream boundary. This is not approval. */
export function questionParagraphStream(sectionId: string, publish: (delta: string) => Promise<void>) {
  let raw = "";
  let published = "";
  let opened = false;
  const emit = async (delta: string) => {
    raw += delta;
    const body = C.researchReportPreview(raw, true).sections[0]?.body ?? "";
    if (!body || !body.startsWith(published) || body.length === published.length) return;
    const prefix = opened ? "" : `{"sectionId":${JSON.stringify(sectionId)},"body":"`;
    const prose = JSON.stringify(body.slice(published.length)).slice(1, -1);
    published = body;
    opened = true;
    await publish(prefix + prose);
  };
  return Object.assign(emit, { reset: () => { raw = ""; published = ""; opened = false; } });
}
