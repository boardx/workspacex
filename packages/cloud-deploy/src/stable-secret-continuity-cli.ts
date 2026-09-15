import { verifyStableSecretContinuity } from "./stable-secret-continuity";

const [baseline, stable, ...extra] = process.argv.slice(2);
if (!baseline || !stable || extra.length) throw new Error("STABLE_SECRET_PREFLIGHT_ARGUMENTS_INVALID");
try {
  process.stdout.write(`CN_STABLE_SECRET_PREFLIGHT ${JSON.stringify(await verifyStableSecretContinuity(baseline, stable))}\n`);
} catch (error) {
  const code = error instanceof Error && /^STABLE_SECRET_[A-Z_]+$/.test(error.message)
    ? error.message : "STABLE_SECRET_CONTINUITY_UNKNOWN";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
