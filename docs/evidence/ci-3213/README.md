# PR #3213 geometry verification wiring

Base: ccaa445d74eb66a32ec9d90b6565dcf21b985eb6. Refs #3205.

The existing `web` script is now invoked by the required `verify-affected` job after dependency installation. Chromium installation is explicit; the existing geometry test uses the real component and compiled CSS without starting an application server or Docker. `--config` replaces the equivalent `-c` shorthand so the existing CI reachability scanner resolves the actual config. No test is removed or exempted.

Validation:
- Isolated `./init.sh`: exit 0 (network-enabled install; /tmp/wsx3213-init.log).
- Coverage before: exit 1 with this spec `[unrun]`; after: exit 0 and the spec covered by its dedicated config.
- Coverage and artifact isolation tests: 13 passed.
- Real Chromium geometry: 1 passed (2.7s). Initial sandbox launch was rejected by macOS MachPort permissions before test execution; rerunning with browser process permissions passed.
- `git diff --check`: clean.

This is a local verification result; GitHub CI must still verify the updated PR commit.
