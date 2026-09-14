import { createHash } from "node:crypto";
import { open, readFile, rename } from "node:fs/promises";
import { classifyReleaseFailures, validatePreparedCnRelease, verifyPreparedReleaseManifest } from "./cn-fast-safe-release";

const fail = (code: string): never => { process.stderr.write(`${code}\n`); process.exit(1); };
const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const command = process.argv[2];

if (command === "bind") {
  const [inputPath, baselineSha256, outputPath] = process.argv.slice(3);
  if (!inputPath || !baselineSha256 || !outputPath) fail("CN_FAST_SAFE_USAGE");
  const inputFile=inputPath as string, baseline=baselineSha256 as string, outputFile=outputPath as string;
  try {
    const input = await readJson(inputFile);
    const receipt = validatePreparedCnRelease({ ...input, baselineSha256: baseline });
    const temporary = `${outputFile}.${process.pid}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, outputFile);
    process.stdout.write("CN_FAST_SAFE_BOUND\n");
  } catch { fail("CN_FAST_SAFE_BIND_FAILED"); }
} else if (command === "validate") {
  const [path, revision, baselineSha256, manifestPath, nowText] = process.argv.slice(3);
  if (!path || !revision || !baselineSha256 || !manifestPath) fail("CN_FAST_SAFE_USAGE");
  const receiptPath=path as string, expectedRevision=revision as string, expectedBaseline=baselineSha256 as string, releaseManifestPath=manifestPath as string;
  try {
    const receipt = validatePreparedCnRelease(await readJson(receiptPath));
    const manifestBytes=await readFile(releaseManifestPath);
    const now = nowText ? new Date(nowText) : new Date();
    if (receipt.sourceRevision !== expectedRevision) fail("CN_FAST_SAFE_REVISION_MISMATCH");
    if (receipt.baselineSha256 !== expectedBaseline) fail("CN_FAST_SAFE_BASELINE_MISMATCH");
    verifyPreparedReleaseManifest(receipt,manifestBytes);
    if (Date.parse(receipt.expiresAt) <= now.getTime()) fail("CN_FAST_SAFE_PREPARATION_EXPIRED");
    if (classifyReleaseFailures(receipt.failures, now).blocked.length) fail("CN_FAST_SAFE_GATES_BLOCKED");
    process.stdout.write("CN_FAST_SAFE_PREPARED\n");
  } catch { fail("CN_FAST_SAFE_INVALID_RECEIPT"); }
} else if (command === "fingerprint") {
  const paths = process.argv.slice(3);
  if (paths.length < 2) fail("CN_FAST_SAFE_USAGE");
  try {
    const hash = createHash("sha256");
    for (const path of paths) {
      const contents=await readFile(path), digest=createHash("sha256").update(contents).digest("hex");
      hash.update(`${contents.length}:${digest}\n`);
    }
    process.stdout.write(`${hash.digest("hex")}\n`);
  } catch { fail("CN_FAST_SAFE_FINGERPRINT_FAILED"); }
} else fail("CN_FAST_SAFE_USAGE");
