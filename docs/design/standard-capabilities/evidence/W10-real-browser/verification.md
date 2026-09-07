# W10 real browser and isolated screenshot storage

Scope: the official Playwright MCP and real Chromium browser run against a local HTML fixture. The fixture explicitly permits only its own local origin; it is not evidence of production public-network SSRF enforcement. Authority and binding resolution are explicit test doubles; this lane is not PostgreSQL permission or production DI evidence.

The original browser test exercises navigation, snapshots, fill, click, and independent browser session storage. Its file store is a Map. The added second test uses the existing native sandbox fixture's UDS relay and real createNativeSessionTransport/createNativeDraftSession implementations to persist the screenshot in an actual isolated session, read it independently, validate PNG magic/dimensions/length/SHA256 against the tool result, destroy the session, and prove subsequent reads fail. Neither browser calls nor screenshot bytes are mocked in the second test.

Opt-in commands:

```sh
WX_NATIVE_SANDBOX_CONTAINER=wx-browser-native-skill-sandbox-sessions-1 pnpm --filter @repo/api run test:browser-real
```

Test container uses existing sessions-only Compose with an image-only override selecting `workspacex-skill-sandbox:w14-audio`, image SHA256 `e981d9e2986f808738d569f4f0b53942258869ffb0e2f3cbec9909a8054fe6ae`. Verified `network_mode=none`, read-only root filesystem, `cap_drop=ALL`, `init=true`, and PID limit 128; original no-new-privileges/seccomp constraints remain. No database is used. The test's host relay accesses only the explicitly named owned test container, never a docker socket exposed to model execution.

The first recorded run failed because Chromium Headless Shell was still downloading. `install-incomplete-red.txt` preserves that actual prerequisite failure, not an adapter failure. Chromium and Headless Shell 153.0.8010.12 (Playwright revision 1243) subsequently installed successfully; see browser-install.txt.

## Actual execution: not passing

Both real tests failed after browser installation (2 failed, 3.00 seconds). Navigation and snapshots reached the actual browser. The original test then failed on checkbox fill: official MCP rejects a boolean at `fields[1].value`, requiring string. The screenshot test reached actual capture, but the upstream relative filename was written to the API process working directory while the adapter read its private `outputDir`, yielding ENOENT. Diagnostic output confirms the actual MCP result, and the two generated PNG files were observed in `apps/api/`. This is an adapter defect, not an accepted success or a mocked screenshot. Cloud adapter owner/root were notified; production adapter was not edited.

`adapter-red.txt` and `adapter-diagnostic.txt` preserve the actual failures. Diagnostic wrapping is test-only, opt-in via `WX_BROWSER_FIXTURE_DIAGNOSTICS=1`, and returns the exact untouched official result. The two generated PNG files and owned `wx-browser-native` container/volume are cleaned after this run. Await adapter correction before reporting real screenshot storage acceptance.
