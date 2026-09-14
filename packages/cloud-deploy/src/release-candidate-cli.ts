import { open, readFile, rename } from "node:fs/promises";
import { sealReleaseCandidate, verifySealedReleaseCandidate } from "./release-candidate.js";

const fail = (code: string): never => { process.stderr.write(`${code}\n`); process.exit(1); };
const [command, manifestPath, sealPath, revision, ...extra] = process.argv.slice(2);
if (!command || !manifestPath || !sealPath || extra.length) fail("CN_RELEASE_CANDIDATE_USAGE");
const manifestFile = manifestPath!;
const sealFile = sealPath!;

try {
  const manifestBytes = await readFile(manifestFile);
  if (command === "seal") {
    if (revision) fail("CN_RELEASE_CANDIDATE_USAGE");
    const seal = sealReleaseCandidate(manifestBytes);
    const temporary = `${sealFile}.${process.pid}.tmp`;
    const handle = await open(temporary, "wx", 0o640);
    try { await handle.writeFile(`${JSON.stringify(seal, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, sealFile);
    process.stdout.write(`CN_RELEASE_CANDIDATE_SEALED revision=${seal.sourceRevision}\n`);
  } else if (command === "validate" && revision) {
    const seal = JSON.parse(await readFile(sealFile, "utf8"));
    verifySealedReleaseCandidate(seal, manifestBytes, revision);
    process.stdout.write(`CN_RELEASE_CANDIDATE_VERIFIED revision=${revision}\n`);
  } else fail("CN_RELEASE_CANDIDATE_USAGE");
} catch (error) {
  const code = error instanceof Error && error.message.startsWith("RELEASE_CANDIDATE_") ? error.message : "CN_RELEASE_CANDIDATE_FAILED";
  fail(code);
}
