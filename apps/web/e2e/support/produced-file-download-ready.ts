export interface ProducedFileDownloadAnchorState {
  href: string | null;
  ariaDisabled: string | null;
}

export interface ProducedFileDownloadWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export const PRODUCED_FILE_DOWNLOAD_READY_TIMEOUT_MS = 120_000;

/**
 * A produced-file card can render as soon as the run reaches terminal while its
 * authenticated bytes are still being fetched. The download becomes real only
 * after the hook has created the page-scoped blob URL and enabled the anchor.
 */
export async function waitForProducedFileDownloadReady(
  readState: () => Promise<ProducedFileDownloadAnchorState>,
  options: ProducedFileDownloadWaitOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? PRODUCED_FILE_DOWNLOAD_READY_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const deadline = now() + timeoutMs;
  let lastState: ProducedFileDownloadAnchorState = { href: null, ariaDisabled: null };

  while (true) {
    lastState = await readState();
    if (lastState.ariaDisabled !== "true" && lastState.href?.startsWith("blob:")) {
      return lastState.href;
    }
    if (now() >= deadline) {
      const hrefShape = lastState.href === null
        ? "<empty>"
        : `${lastState.href.slice(0, Math.max(lastState.href.indexOf(":") + 1, 16))}`;
      throw new Error(
        `produced-file download still disabled after ${timeoutMs}ms `
        + `(aria-disabled=${lastState.ariaDisabled ?? "<missing>"}, href=${hrefShape})`,
      );
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
  }
}
