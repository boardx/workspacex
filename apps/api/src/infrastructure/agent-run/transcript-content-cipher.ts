/**
 * `TranscriptContentCipher` implementation (Phase 14 F15, R3'/R6, `error-observability`
 * contract bundle) -- field-level encryption for the FULL (non-digest, non-truncated)
 * `agent_run_steps` content the audit interface (`getRunTranscript`) reads back.
 *
 * ## This is deliberately NOT `aes-credential-cipher.ts` with a decrypt bolted on
 *
 * That file's header is explicit: no inverse, ever, by design (`credential-vault.ts`'s
 * `CredentialCipher` port declares only `encrypt`). Adding `decrypt` there would break that
 * invariant for every existing importer. This feature's whole point is the opposite: an
 * authorized role (`admin`, see `get-run-transcript.ts`) MUST be able to read the full
 * content back (R3'-3: "完整回放模型看到了什么、完整说了什么"). Same algorithm and
 * ciphertext layout as the credential cipher (AES-256-GCM, `<iv-hex>.<authTag-hex>.
 * <ciphertext-hex>`, per-call random IV) because that shape is already reviewed and correct
 * for this project -- but its own module, its own key, its own review, exactly as that
 * file's header asks for the day an inverse is needed.
 *
 * ## `decrypt` never throws
 *
 * A wrong/rotated key, tampered ciphertext, or malformed input all collapse to `null`. I-4
 * requires `decryptStatus: "unreadable"` for these cases, not a 500 that would take down the
 * ENTIRE transcript read over one bad row (E3: "报告『内容不可读』而非...报错崩溃").
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { TranscriptContentCipher } from "../../application/agent-run/ports";

/**
 * How the key is supplied. Unlike `MODEL_CREDENTIAL_KEY_ENV`, a missing value here is NOT a
 * startup failure (`transcriptContentCipherFromEnv` returns `null`, not a throw) --
 * `agent_run_steps.appendStep` degrades to "no full content this step" rather than failing
 * every agent run outright, and `getRunTranscript` degrades to `decryptStatus: "unreadable"`
 * for every step rather than a 500. Both are honest, visible degradations (never a silent
 * empty value pretending to be real content), and neither takes down unrelated functionality
 * over a missing encryption key -- exactly what E3 asks for on the read side, extended
 * symmetrically to the write side so the two never disagree about why content is missing.
 */
export const AGENT_RUN_TRANSCRIPT_KEY_ENV = "AGENT_RUN_TRANSCRIPT_KEY";

export class AesGcmTranscriptContentCipher implements TranscriptContentCipher {
  readonly algorithm = "aes-256-gcm";

  /** 32 bytes derived from the supplied material. Private: nothing outside may read it. */
  readonly #key: Buffer;

  constructor(key: string) {
    if (key.length === 0) {
      throw new Error("refusing to build a transcript content cipher from an empty key");
    }
    this.#key = createHash("sha256").update(key, "utf8").digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.#key, iv);
    const body = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
    return `${iv.toString("hex")}.${c.getAuthTag().toString("hex")}.${body.toString("hex")}`;
  }

  decrypt(ciphertext: string): string | null {
    const parts = ciphertext.split(".");
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, dataHex] = parts;
    if (ivHex === undefined || tagHex === undefined || dataHex === undefined) return null;
    try {
      const d = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(ivHex, "hex"));
      d.setAuthTag(Buffer.from(tagHex, "hex"));
      const plain = Buffer.concat([d.update(Buffer.from(dataHex, "hex")), d.final()]);
      return plain.toString("utf8");
    } catch {
      // Wrong/rotated key, tampered ciphertext, or malformed hex -- see this file's header.
      return null;
    }
  }
}

/**
 * Build the cipher from the environment, or `null` when unconfigured -- see
 * `AGENT_RUN_TRANSCRIPT_KEY_ENV`'s own doc for why this does not throw the way
 * `credentialCipherFromEnv` does.
 */
export function transcriptContentCipherFromEnv(): AesGcmTranscriptContentCipher | null {
  const key = process.env[AGENT_RUN_TRANSCRIPT_KEY_ENV];
  if (key === undefined || key === "") return null;
  return new AesGcmTranscriptContentCipher(key);
}
