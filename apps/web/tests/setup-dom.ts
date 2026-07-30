/**
 * setup-dom.ts — vitest setup shared by every test in `apps/web`.
 *
 * Runs in BOTH environments (see `vitest.config.ts`): `node` for the source-text gates,
 * `jsdom` for `tests/**\/*.test.tsx` component tests. Therefore everything DOM-specific is
 * behind a `typeof document` guard -- an unguarded `@testing-library/react` import would make
 * the node-env gates fail on setup, which is exactly the kind of breakage that gets "fixed"
 * by deleting the setup file and losing the matchers.
 */
import { afterEach } from "vitest";

// jest-dom's matchers (`toBeVisible`, `toHaveAttribute`, …) are plain `expect.extend` calls and
// are safe to register without a DOM; registering them unconditionally keeps the two
// environments' `expect` identical.
import "@testing-library/jest-dom/vitest";

if (typeof document !== "undefined") {
  // Unmount between tests. Without this, a component rendered by test A is still in the document
  // during test B, and a `getByTestId` that should have thrown finds the stale node instead --
  // a green that means nothing.
  afterEach(async () => {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  });
}
