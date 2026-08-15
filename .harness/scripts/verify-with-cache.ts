#!/usr/bin/env -S pnpm exec tsx
// verify-with-cache.ts — 用法: tsx verify-with-cache.ts <verificationType> -- <command...>
//
// `harness verify`、pre-push、CI 遇到相同 SHA + 相同验证配置（type）时复用结果，
// 不重复跑一遍已经跑过的验证。命中就打印证据并原样返回记录的退出码；没命中就
// 真跑一遍，跑完记录凭证再返回。verify-cache.ts 只管存取，本文件管"要不要跑"。
import { spawnSync } from "node:child_process";
import {
  computeFingerprint,
  currentSha,
  lookupCredential,
  recordCredential,
} from "./lib/verify-cache";

function main(): void {
  const args = process.argv.slice(2);
  const sep = args.indexOf("--");
  if (sep < 0 || sep === 0) {
    console.error("usage: tsx verify-with-cache.ts <verificationType> -- <command...>");
    process.exit(2);
  }
  const verificationType = args[0]!;
  const command = args.slice(sep + 1);
  if (command.length === 0) {
    console.error("usage: tsx verify-with-cache.ts <verificationType> -- <command...>");
    process.exit(2);
  }

  const sha = currentSha();
  const fingerprint = computeFingerprint(sha);
  const hit = lookupCredential(verificationType, sha, fingerprint);

  if (hit) {
    console.log(
      `[verify-cache] 命中缓存凭证，跳过实际执行：type=${verificationType} sha=${sha.slice(0, 8)} ` +
        `完成于 ${hit.completedAt}，当时退出码=${hit.exitCode}`,
    );
    process.exit(hit.exitCode);
  }

  console.log(
    `[verify-cache] 未命中（type=${verificationType} sha=${sha.slice(0, 8)} fingerprint=${fingerprint.slice(0, 12)}…），实际执行：${command.join(" ")}`,
  );
  const result = spawnSync(command[0]!, command.slice(1), { stdio: "inherit" });
  const exitCode = result.status ?? 1;

  recordCredential({
    sha,
    fingerprint,
    verificationType,
    command: command.join(" "),
    exitCode,
    completedAt: new Date().toISOString(),
  });

  process.exit(exitCode);
}

main();
