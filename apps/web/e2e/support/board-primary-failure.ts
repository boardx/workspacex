/** Private acceptance diagnostics keep the first failure without serializing login secrets. */
export function primaryFailure(error: unknown, secrets: readonly string[] = []): unknown {
  if (error == null) return null;
  if (!(error instanceof Error)) return {name: 'NonErrorFailure'};
  const redact = (value: string | undefined) => {
    if (value === undefined) return value;
    for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
      value = value.replaceAll(secret, '[REDACTED]');
    }
    return value;
  };
  return {name: redact(error.name), message: redact(error.message), stack: redact(error.stack),
    ...(error instanceof AggregateError ? {errors: [...error.errors].map(value => primaryFailure(value, secrets))} : {})};
}
export function acceptanceFailureSecrets(fixture: Record<string, unknown>, ...tokens: string[]) {
  return [...Object.entries(fixture).filter(([key]) => key.toLowerCase().includes('password')).map(([, value]) => value).filter((value): value is string => typeof value === 'string'), ...tokens];
}
