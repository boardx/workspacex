import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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
    return this.hmac(`verification-token:${challengeId}`);
  }

  digest(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  pendingProofForChallenge(challengeId: string): string {
    return `${challengeId}.${this.hmac(`pending-identity:${challengeId}`)}`;
  }

  challengeIdFromPendingProof(proof: string): string | null {
    const [challengeId, signature, extra] = proof.split(".");
    if (extra !== undefined || !challengeId?.match(/^[0-9a-f]{64}$/) || !signature?.match(/^[0-9a-f]{64}$/)) {
      return null;
    }
    const expected = this.hmac(`pending-identity:${challengeId}`);
    return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex")) ? challengeId : null;
  }

  private hmac(value: string): string {
    return createHmac("sha256", this.secret).update(value).digest("hex");
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
