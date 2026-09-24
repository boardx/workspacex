import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { MODEL_CREDENTIAL_KEY_ENV } from "../model/aes-credential-cipher";
import type { Principal } from "../../domain/principal";
import type {
  MuralCredentialCipher,
  MuralPlainCredential,
} from "../../application/whiteboard/mural-ports";

const ALGORITHM = "aes-256-gcm";
const aad = (p: Principal) =>
  Buffer.from(`whiteboard-mural\0${p.orgId}\0${p.userId}`, "utf8");

/** Module-private inverse: plaintext only exists while calling Mural and never crosses a port response. */
export class AesMuralCredentialCipher implements MuralCredentialCipher {
  readonly #key: Buffer;
  constructor(key: string) {
    if (!key) throw new Error("MURAL_CREDENTIAL_KEY_MISSING");
    this.#key = createHash("sha256").update(key, "utf8").digest();
  }
  seal(principal: Principal, value: MuralPlainCredential): string {
    const iv = randomBytes(12),
      cipher = createCipheriv(ALGORITHM, this.#key, iv);
    cipher.setAAD(aad(principal));
    const body = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  }
  open(principal: Principal, value: string): MuralPlainCredential {
    try {
      const bytes = Buffer.from(value, "base64");
      if (bytes.byteLength < 29) throw new Error("short");
      const decipher = createDecipheriv(
        ALGORITHM,
        this.#key,
        bytes.subarray(0, 12),
      );
      decipher.setAAD(aad(principal));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const parsed: unknown = JSON.parse(
        Buffer.concat([
          decipher.update(bytes.subarray(28)),
          decipher.final(),
        ]).toString("utf8"),
      );
      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof (parsed as { access?: unknown }).access !== "string" ||
        !("refresh" in parsed) ||
        ((parsed as { refresh: unknown }).refresh !== null &&
          typeof (parsed as { refresh: unknown }).refresh !== "string")
      )
        throw new Error("shape");
      return parsed as MuralPlainCredential;
    } catch {
      throw new Error("MURAL_CREDENTIAL_UNAVAILABLE");
    }
  }
}

export function muralCredentialCipherFromEnv(): AesMuralCredentialCipher {
  return new AesMuralCredentialCipher(
    process.env[MODEL_CREDENTIAL_KEY_ENV] ?? "",
  );
}

export class EnvironmentMuralCredentialCipher implements MuralCredentialCipher {
  seal(principal: Principal, value: MuralPlainCredential) {
    return muralCredentialCipherFromEnv().seal(principal, value);
  }
  open(principal: Principal, value: string) {
    return muralCredentialCipherFromEnv().open(principal, value);
  }
}
