# Promotion fixture portability verification — 2026-10-24 (Asia/Shanghai)

Scope: only `.harness/scripts/vm/cn-promotion-prepared-receipt.test.ts`. Production code and assertions remain unchanged; fixture output and summary assertions now inspect actual private files rather than captured stdout.

Base checkout at the final evidence rerun: `3bc3f04bf58d6a29b32abbfa1322cf4db0bad493`, containing the committed test fix. Tested file SHA-256: `5de1446d68c296ad6b37ad652d08ab3802d3018c5719beb79ae42a5cc74744b0`.

Root cause: on Linux, Node `spawnSync` captures child stdout using a socket. Bash cannot reopen it through `/dev/stdout` (`No such device or address`). The old fixture incorrectly used that path for both GitHub file channels. The corrected fixture uses an isolated `mkdtemp` directory with mode-0600 output and summary files, reads them after the child exits, and removes them in `finally`. Exact successful output, summary, and rejected-attempt/target/entrypoint negative assertions remain enforced.

From the repository root, the exact macOS verification command was:

```bash
pnpm exec vitest run --config .harness/vitest.config.ts cn-promotion-prepared-receipt.test.ts > docs/evidence/cn-auto-release-5910/fixture-portability-macos.log 2>&1
```

Result: **14/14 passed**, exit 0. Full output: [macOS log](fixture-portability-macos.log).

The exact Linux reproduction and verification command was:

```bash
bash docs/evidence/cn-auto-release-5910/fixture-portability-linux.sh > docs/evidence/cn-auto-release-5910/fixture-portability-linux.log 2>&1
```

[The script](fixture-portability-linux.sh) records the complete Docker command. It uses `workspacex-cn-host-tests:node22` with a read-only source mount and independent Linux Vitest dependencies. It first reproduces the old `/dev/stdout` failure with real Linux Node `spawnSync`, then runs the current full test file. Result: old fixture exit **1** with the CI error; fixed tests **14/14 passed**, overall script exit **0**. Full output: [Linux log](fixture-portability-linux.log).

Cleanup: the Docker command uses `--rm`. The final script check runs `docker ps -aq --filter 'name=^/cn-promotion-fixture-portability$'` and requires an empty result. The Linux log records **PASS: container removed (--rm); no matching running or stopped container**. Test channel files are also removed in `finally`. No repository dependencies were installed or modified by the container.
