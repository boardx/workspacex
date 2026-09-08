import { ModelCallError } from "../agent-run/ports";
/** Retry only explicitly classified provider failures, never arbitrary application errors. */
export function recoverableReportProviderError(error: unknown): boolean {
  if (!(error instanceof ModelCallError) || error.code !== "MODEL_CALL_FAILED") return false;
  return /^model provider responded with HTTP (429|5\d\d)$/.test(error.detail)
    || /^model provider (?:stream )?transport failure \((?:UND_ERR_(?:HEADERS_TIMEOUT|BODY_TIMEOUT|CONNECT_TIMEOUT|SOCKET|CLOSED)|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENETUNREACH)\)$/.test(error.detail);
}
