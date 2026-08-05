export const PENDING_VERIFICATION_COOKIE = "wsx.pendingVerification";

export function readPendingVerificationCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(";")) {
    const [name, ...value] = item.trim().split("=");
    if (name === PENDING_VERIFICATION_COOKIE) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function pendingVerificationSetCookie(proof: string, production: boolean): string {
  return [
    `${PENDING_VERIFICATION_COOKIE}=${encodeURIComponent(proof)}`,
    "Path=/",
    "Max-Age=86400",
    "HttpOnly",
    "SameSite=Lax",
    production ? "Secure" : null,
  ].filter(Boolean).join("; ");
}
