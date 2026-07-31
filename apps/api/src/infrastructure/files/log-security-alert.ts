/**
 * `SecurityAlertPort` (F35) -- logs to stderr.
 *
 * No paging/notification channel exists in this codebase yet, so this is the honest
 * deployment-independent implementation: it makes the alert observable (a line an operator
 * or a log pipeline can pick up) without inventing a channel this feature does not own.
 * Swapping in real paging later is a second implementation of the same port.
 */
import type { SecurityAlert, SecurityAlertPort } from "../../application/files/upload-ports";

export class LogSecurityAlert implements SecurityAlertPort {
  async raise(alert: SecurityAlert): Promise<void> {
    // eslint-disable-next-line no-console -- this IS the alert channel for now
    console.error(
      `[SECURITY ALERT] org=${alert.orgId} kind=${alert.kind} file=${alert.filename} hash=${alert.contentHash}: ${alert.detail}`,
    );
  }
}
