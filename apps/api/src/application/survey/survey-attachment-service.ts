import { createHash, randomBytes, randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import type { SurveyRuntime } from "@repo/contracts/survey-runtime";
import type { TenantSession } from "../ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { ObjectStore } from "../artifact/ports";
import type { PhysicalPurgePort } from "../files/physical-delete-ports";
import { sniffKind } from "../../domain/files/mime-sniff";
import { scanForMalware } from "../../domain/files/malware-scan";
export const SURVEY_ATTACHMENT_SERVICE = Symbol("SurveyAttachmentService");
import {
  SURVEY_UPLOAD_MAX_BYTES,
  SURVEY_UPLOAD_MAX_FILES,
} from "@repo/contracts/survey-question-types";
export {
  SURVEY_UPLOAD_MAX_BYTES,
  SURVEY_UPLOAD_MAX_FILES,
} from "@repo/contracts/survey-question-types";
export class SurveyAttachmentError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "closed"
      | "invalid_attachment"
      | "limit_exceeded"
      | "invalid_file",
  ) {
    super(code);
  }
}
export interface AttachmentContext {
  s: TenantSession;
  orgId: OrgId;
  surveyId: string;
  publication: NonNullable<SurveyRuntime["publication"]>;
}
export interface StoredSurveyAttachment {
  attachmentId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  objectKey: string;
}
export interface AttachmentRepository {
  createSession(
    token: string,
    submissionId: string,
    sessionToken: string,
  ): Promise<{ expiresAt: string; orgId: OrgId }>;
  reserve(
    token: string,
    sessionToken: string,
    questionId: string,
    file: StoredSurveyAttachment,
    sha256: string,
  ): Promise<void>;
  ready(
    token: string,
    sessionToken: string,
    attachmentId: string,
    write: () => Promise<void>,
  ): Promise<void>;
  authorize(
    token: string,
    sessionToken: string,
    questionId: string,
  ): Promise<void>;
  remove(
    token: string,
    sessionToken: string,
    questionId: string,
    id: string,
  ): Promise<void>;
  readPublic(
    token: string,
    sessionToken: string,
    questionId: string,
    id: string,
  ): Promise<StoredSurveyAttachment>;
  readOwner(
    orgId: OrgId,
    surveyId: string,
    ownerId: string,
    responseId: string,
    id: string,
  ): Promise<StoredSurveyAttachment>;
  cleanup(orgId: OrgId, purge: PhysicalPurgePort): Promise<number>;
}
const MIME_KINDS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "text",
  "text/csv": "text",
  "text/markdown": "text",
};
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Validate PNG structure, checksums and bounded decoded scanlines for every legal
 * color/depth combination and Adam7 interlacing. File uploads are not restricted
 * to the RGB/RGBA representation emitted by the signature canvas. */
function validatePng(bytes: Uint8Array): void {
  const b = Buffer.from(bytes);
  let pos = 8,
    width = 0,
    height = 0,
    depth = 0,
    color = -1,
    interlace = 0;
  let palette = false,
    ended = false,
    dataEnded = false;
  const chunks: Buffer[] = [];
  const legalDepths: Record<number, readonly number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  while (pos + 12 <= b.length) {
    const n = b.readUInt32BE(pos);
    if (n > b.length - pos - 12) throw new Error("chunk_length");
    const type = b.toString("latin1", pos + 4, pos + 8);
    if (
      !/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type) ||
      crc32(b.subarray(pos + 4, pos + 8 + n)) !== b.readUInt32BE(pos + 8 + n)
    )
      throw new Error("chunk_crc");
    if (pos === 8 && type !== "IHDR") throw new Error("missing_header");
    if (type === "IHDR") {
      if (pos !== 8 || n !== 13) throw new Error("invalid_header");
      width = b.readUInt32BE(pos + 8);
      height = b.readUInt32BE(pos + 12);
      depth = b[pos + 16]!;
      color = b[pos + 17]!;
      interlace = b[pos + 20]!;
      if (
        !width ||
        !height ||
        width * height > 4_000_000 ||
        !legalDepths[color]?.includes(depth) ||
        b[pos + 18] !== 0 ||
        b[pos + 19] !== 0 ||
        interlace > 1
      )
        throw new Error("invalid_header");
    } else if (type === "PLTE") {
      if (
        palette ||
        chunks.length ||
        color === 0 ||
        color === 4 ||
        !n ||
        n % 3 ||
        n > 768 ||
        (color === 3 && n / 3 > 2 ** depth)
      )
        throw new Error("invalid_palette");
      palette = true;
    } else if (type === "IDAT") {
      if (dataEnded || (color === 3 && !palette))
        throw new Error("invalid_data_order");
      chunks.push(b.subarray(pos + 8, pos + 8 + n));
    } else {
      if (chunks.length) dataEnded = true;
      if (type === "IEND") {
        if (n !== 0) throw new Error("invalid_end");
        ended = true;
      } else if (type[0] === type[0]!.toUpperCase())
        throw new Error("unknown_critical_chunk");
    }
    pos += n + 12;
    if (ended) break;
  }
  if (!ended || pos !== b.length || !chunks.length)
    throw new Error("incomplete_image");
  const passes =
    interlace === 0
      ? [[0, 0, 1, 1]]
      : [
          [0, 0, 8, 8],
          [4, 0, 8, 8],
          [0, 4, 4, 8],
          [2, 0, 4, 4],
          [0, 2, 2, 4],
          [1, 0, 2, 2],
          [0, 1, 1, 2],
        ];
  const layouts = passes.map(([x, y, dx, dy]) => {
    const w = Math.max(0, Math.ceil((width - x!) / dx!)),
      h = Math.max(0, Math.ceil((height - y!) / dy!));
    return {
      h: w ? h : 0,
      rowBytes: Math.ceil((w * channels[color]! * depth) / 8),
    };
  });
  const expected = layouts.reduce(
    (sum, pass) => sum + pass.h * (pass.rowBytes + 1),
    0,
  );
  const raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: expected });
  if (raw.length !== expected) throw new Error("invalid_scanlines");
  let offset = 0;
  for (const pass of layouts)
    for (let y = 0; y < pass.h; y++) {
      if (raw[offset]! > 4) throw new Error("invalid_filter");
      offset += pass.rowBytes + 1;
    }
}
export function validateSurveyUpload(bytes: Uint8Array, mime: string): void {
  if (!bytes.length || bytes.length > SURVEY_UPLOAD_MAX_BYTES)
    throw new SurveyAttachmentError("limit_exceeded");
  if (
    !MIME_KINDS[mime] ||
    sniffKind(bytes) !== MIME_KINDS[mime] ||
    !scanForMalware(bytes).clean
  )
    throw new SurveyAttachmentError("invalid_file");
  if (MIME_KINDS[mime] === "text") {
    try {
      new TextDecoder("utf8", { fatal: true }).decode(bytes);
      if (bytes.includes(0)) throw 0;
    } catch {
      throw new SurveyAttachmentError("invalid_file");
    }
  }
  if (mime === "image/png") {
    try {
      validatePng(bytes);
    } catch {
      throw new SurveyAttachmentError("invalid_file");
    }
  }
}
export class SurveyAttachmentService {
  constructor(
    private readonly repo: AttachmentRepository,
    private readonly store: ObjectStore,
    private readonly purge: PhysicalPurgePort,
  ) {}
  async createSession(token: string, submissionId: string) {
    if (submissionId.length < 8 || submissionId.length > 128)
      throw new SurveyAttachmentError("invalid_attachment");
    const uploadSessionToken = randomBytes(32).toString("base64url");
    const { expiresAt, orgId } = await this.repo.createSession(
      token,
      submissionId,
      uploadSessionToken,
    );
    await this.cleanup(orgId);
    return { uploadSessionToken, expiresAt };
  }
  async upload(
    token: string,
    sessionToken: string,
    questionId: string,
    file: { name: string; mime: string; bytes: Uint8Array },
  ) {
    validateSurveyUpload(file.bytes, file.mime);
    const attachmentId = randomUUID();
    const row = {
      attachmentId,
      name: file.name.replace(/[\r\n\x00]/g, "").slice(0, 200) || "attachment",
      mime: file.mime,
      sizeBytes: file.bytes.length,
      objectKey: `survey-attachments/${attachmentId}`,
    };
    await this.repo.reserve(
      token,
      sessionToken,
      questionId,
      row,
      createHash("sha256").update(file.bytes).digest("hex"),
    );
    // Reservation commits first: a crash after writing bytes remains discoverable by cleanup.
    await this.repo.ready(token, sessionToken, attachmentId, () =>
      this.store.putOnce(row.objectKey, file.bytes, file.mime),
    );
    const { objectKey: _, ...publicRow } = row;
    return publicRow;
  }
  authorize(token: string, sessionToken: string, q: string) {
    return this.repo.authorize(token, sessionToken, q);
  }
  remove(token: string, sessionToken: string, q: string, id: string) {
    return this.repo.remove(token, sessionToken, q, id);
  }
  async publicContent(
    token: string,
    sessionToken: string,
    q: string,
    id: string,
  ) {
    return this.content(await this.repo.readPublic(token, sessionToken, q, id));
  }
  async ownerContent(
    org: OrgId,
    survey: string,
    owner: string,
    response: string,
    id: string,
  ) {
    return this.content(
      await this.repo.readOwner(org, survey, owner, response, id),
    );
  }
  private async content(row: StoredSurveyAttachment) {
    const bytes = await this.store.get(row.objectKey);
    if (!bytes) throw new SurveyAttachmentError("not_found");
    return { ...row, bytes };
  }
  cleanup(org: OrgId) {
    return this.repo.cleanup(org, this.purge);
  }
}
