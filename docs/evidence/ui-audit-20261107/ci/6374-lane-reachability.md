# PR 6374: test lane reachability follow-up

The merge-group control-plane gate identified an orphan Vitest config. Added a named npm script that actually executes the existing configuration. No test, exemption, production behavior, or CI policy was removed or weakened.

- Exact prior head: acf2d49398bb0ec701e3769ca29d6a081e9a50a9.
- `pnpm --filter @repo/api run test:report-approval-unit`: exit 0; 74 tests in 5 files passed.
- `pnpm run lint:vitest-config-reachability`: exit 0 after both independently introduced orphan configurations have their own scripts; 73 configs / 12 live specs covered in the local integration. The isolated survey PR alone also passes its own gate (72 configs / 12 live specs).
- Both configurations use service-port mocks without database or object-store services.
- Root applied and executed the actual scripts; independent review checked configuration environment requirements. PR head CI and the new merge group remain required.
