# PR 6366: test lane reachability follow-up

The merge-group control-plane gate identified an orphan Vitest config. Added a named npm script that actually executes the existing configuration. No test, exemption, production behavior, or CI policy was removed or weakened.

- Exact prior head: 9c97a518bb9625e69be90da815060a6d2bf4d75e.
- `pnpm --filter @repo/api run test:survey-attachment-metadata-unit`: exit 0; 1 test in 1 file passed.
- `pnpm run lint:vitest-config-reachability`: exit 0 after both independently introduced orphan configurations have their own scripts; 73 configs / 12 live specs covered in the local integration. The isolated survey PR alone also passes its own gate (72 configs / 12 live specs).
- Both configurations use service-port mocks without database or object-store services.
- Root applied and executed the actual scripts; independent review checked configuration environment requirements. PR head CI and the new merge group remain required.
