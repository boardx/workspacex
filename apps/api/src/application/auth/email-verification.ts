import { EMAIL_VERIFICATION_TTL_MS } from "../../domain/auth/email-verification";
import { normalizeEmail } from "../../domain/auth/registration";
import type {
  EmailVerificationRepository,
  EmailVerificationTokenCodec,
  VerificationMailTransport,
} from "./email-verification-ports";

export async function confirmEmailVerification(input: {
  token: string;
  now: Date;
  repo: EmailVerificationRepository;
  tokens: EmailVerificationTokenCodec;
}) {
  return input.repo.confirmDigest(input.tokens.digest(input.token), input.now);
}

export async function resendEmailVerification(input: {
  email: string;
  now: Date;
  repo: EmailVerificationRepository;
  tokens: EmailVerificationTokenCodec;
}): Promise<{ verificationDelivery: "queued" }> {
  const challengeId = input.tokens.newChallengeId();
  const raw = input.tokens.tokenForChallenge(challengeId);
  await input.repo.requestResend({
    email: normalizeEmail(input.email),
    challengeId,
    tokenDigest: input.tokens.digest(raw),
    outboxId: `verify-${challengeId}`,
    expiresAt: new Date(input.now.getTime() + EMAIL_VERIFICATION_TTL_MS),
    now: input.now,
  });
  return { verificationDelivery: "queued" };
}

export async function deliverOneVerificationMail(input: {
  now: Date;
  appPublicUrl: string;
  repo: EmailVerificationRepository;
  tokens: EmailVerificationTokenCodec;
  transport: VerificationMailTransport;
}): Promise<"idle" | "delivered" | "retryable" | "failed"> {
  const message = await input.repo.claimDue(input.now);
  if (!message) return "idle";
  const token = input.tokens.tokenForChallenge(message.challengeId);
  const url = new URL("/auth/verify-email", input.appPublicUrl);
  url.searchParams.set("token", token);
  try {
    const delivered = await input.transport.deliver({
      outboxId: message.id,
      to: message.recipient,
      verificationUrl: url.toString(),
    });
    await input.repo.markDelivered(message.id, delivered.providerMessageId, input.now);
    return "delivered";
  } catch (error) {
    const failure = error as { category?: string; retryable?: boolean };
    const retryable = failure.retryable === true;
    const delayMs = Math.min(60_000 * 2 ** Math.max(message.attemptCount - 1, 0), 3_600_000);
    await input.repo.markFailed({
      id: message.id,
      at: input.now,
      category: failure.category ?? "transport_unknown",
      retryable,
      nextAttemptAt: new Date(input.now.getTime() + delayMs),
    });
    return retryable ? "retryable" : "failed";
  }
}
