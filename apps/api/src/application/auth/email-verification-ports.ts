export interface MailOutboxMessage {
  readonly id: string;
  readonly challengeId: string;
  readonly recipient: string;
  readonly attemptCount: number;
}

export interface VerificationConfirmation {
  readonly outcome: "completed" | "invalid";
}

export interface EmailVerificationRepository {
  confirmDigest(digest: string, now: Date): Promise<VerificationConfirmation>;
  requestResend(input: {
    email: string;
    challengeId: string;
    tokenDigest: string;
    outboxId: string;
    expiresAt: Date;
    now: Date;
  }): Promise<void>;
  claimDue(now: Date): Promise<MailOutboxMessage | null>;
  markDelivered(id: string, providerMessageId: string, at: Date): Promise<void>;
  markFailed(input: {
    id: string;
    at: Date;
    category: string;
    retryable: boolean;
    nextAttemptAt: Date;
  }): Promise<void>;
}

export interface EmailVerificationTokenCodec {
  newChallengeId(): string;
  tokenForChallenge(challengeId: string): string;
  digest(token: string): string;
}

export interface VerificationMailTransport {
  deliver(input: {
    outboxId: string;
    to: string;
    verificationUrl: string;
  }): Promise<{ providerMessageId: string }>;
}

export const EMAIL_VERIFICATION_REPOSITORY = Symbol("EmailVerificationRepository");
export const EMAIL_VERIFICATION_TOKEN_CODEC = Symbol("EmailVerificationTokenCodec");
export const VERIFICATION_MAIL_TRANSPORT = Symbol("VerificationMailTransport");
