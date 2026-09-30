import { candidateConfigHostAction, candidateIdentitySchema } from "./cn-candidate-config";
try {
  const [action, revision, release, attemptId, ...extra] = process.argv.slice(2);
  if (extra.length || !["prepare", "verify", "commit", "restore"].includes(action ?? "")) throw new Error();
  const identity = candidateIdentitySchema.parse({ revision, release, attemptId });
  const result = await candidateConfigHostAction(action as "prepare" | "verify" | "commit" | "restore", identity);
  console.log(JSON.stringify(result));
} catch {
  console.error(JSON.stringify({ ok: false, reason: "candidate_configuration_rejected" }));
  process.exitCode = 1;
}
