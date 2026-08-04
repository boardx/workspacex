import { createHash, createHmac, randomBytes } from "node:crypto";
import type { EmailVerificationTokenCodec } from "../../application/auth/email-verification-ports";

export class HmacEmailVerificationTokenCodec implements EmailVerificationTokenCodec {
  constructor(private readonly secret: string) {
    if (Buffer.byteLength(secret) < 32) {
      throw new Error("EMAIL_VERIFICATION_SECRET must contain at least 32 bytes");
    }
  }

  newChallengeId(): string {
    return randomBytes(32).toString("hex");
  }

  tokenForChallenge(challengeId: string): string {
    return createHmac("sha256", this.secret).update(challengeId).digest("hex");
  }

  digest(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

}

export function emailVerificationSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.EMAIL_VERIFICATION_SECRET;
  if (configured) return configured;
  if (env.NODE_ENV === "production") {
    throw new Error("EMAIL_VERIFICATION_SECRET is required in production");
  }
  return "workspacex-development-email-verification-secret-change-me";
}
