import type { AidtContextErrorCode } from "@repo/contracts/aidt-run-context";
/** Public reason is a closed contract code, never dependency detail or student content. */
export class AidtContextError extends Error {
  constructor(readonly reasonCode: AidtContextErrorCode) { super(reasonCode); }
}
