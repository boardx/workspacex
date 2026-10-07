import { constants, createBrotliCompress, createGzip } from "node:zlib";
import type { IncomingMessage } from "node:http";
import type { Response } from "express";

/** Prefer the client's quality ordering; absent/forbidden encodings stay identity. */
export function researchStreamEncoding(header: string | undefined): "br" | "gzip" | undefined {
  const accepted = new Map<string, number>();
  for (const part of header?.split(",") ?? []) {
    const [name, ...parameters] = part.trim().toLowerCase().split(";");
    const q = parameters.map(value => value.trim()).find(value => value.startsWith("q="))?.slice(2);
    const quality = q === undefined ? 1 : /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(q) ? Number(q) : 0;
    accepted.set(name ?? "", quality);
  }
  const quality = (encoding: string) => accepted.get(encoding) ?? accepted.get("*") ?? 0;
  const br = quality("br"), gzip = quality("gzip");
  return br > 0 && br >= gzip ? "br" : gzip > 0 ? "gzip" : undefined;
}

/** Each SSE frame flushes independently: compression must never delay progress
 * until model execution completes. No public payload or persisted evidence changes. */
export function createResearchStreamWriter(request: Pick<IncomingMessage, "headers">, response: Response) {
  const encoding = researchStreamEncoding(request.headers?.["accept-encoding"]);
  const previousVary = response.getHeader?.("Vary");
  response.setHeader("Vary", [previousVary, "Accept-Encoding"].filter(Boolean).join(", "));
  if (!encoding) {
    const frames: string[] = [];
    let queuedBytes = 0, blocked = false, ending = false, closed = false;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    let finish!: () => void;
    const completed = new Promise<void>(resolve => { finish = resolve; });
    const cleanup = () => { clearTimeout(drainTimer); response.off("drain", drain); response.off("close", abort); response.off("error", abort); };
    const abort = () => { if (closed) return; closed = true; cleanup(); frames.length = 0; if (!response.destroyed) response.destroy(); finish(); };
    const pump = () => {
      while (!closed && !blocked && frames.length) {
        const frame = frames.shift()!;
        queuedBytes -= Buffer.byteLength(frame);
        blocked = response.write(frame) === false;
      }
      if (ending && !closed && !blocked && !frames.length) { closed = true; cleanup(); if (!response.destroyed && !response.writableEnded) response.end(); finish(); }
    };
    const drain = () => { blocked = false; pump(); };
    response.on("drain", drain); response.on("close", abort); response.on("error", abort);
    return {
      write(frame: string) {
        if (closed || ending || response.destroyed) return;
        const bytes = Buffer.byteLength(frame);
        if (queuedBytes + bytes + response.writableLength > 16 * 1048576) { abort(); return; }
        frames.push(frame); queuedBytes += bytes; pump();
      },
      async end() {
        if (closed) return;
        if (!ending) { ending = true; drainTimer = setTimeout(abort, 5000); drainTimer.unref(); pump(); }
        await completed;
      },
    };
  }
  response.setHeader("Content-Encoding", encoding);
  response.removeHeader("Content-Length");
  const stream = encoding === "br" ? createBrotliCompress({ params: {
    [constants.BROTLI_PARAM_QUALITY]: 6,
    // The previous attempt may repeat a multi-MB source snapshot. The window
    // remains bounded, but can find repetitions beyond gzip's 32 KiB window.
    [constants.BROTLI_PARAM_LGWIN]: 24,
  } }) : createGzip({ level: 6 });
  let closed = false;
  let ending = false;
  let queuedBytes = 0;
  let queue = Promise.resolve();
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  let finish!: () => void;
  const completed = new Promise<void>(resolve => { finish = resolve; });
  const abort = () => {
    if (closed) return;
    closed = true;
    clearTimeout(drainTimer);
    stream.destroy();
    response.off("close", abort);
    response.off("error", abort);
    response.off("finish", complete);
    if (!response.destroyed) response.destroy();
    finish();
  };
  const complete = () => {
    clearTimeout(drainTimer);
    closed = true;
    response.off("close", abort);
    response.off("error", abort);
    response.off("finish", complete);
    finish();
  };
  stream.on("error", abort);
  response.on("close", abort);
  response.on("error", abort);
  response.on("finish", complete);
  stream.on("end", () => { if (!closed && !response.destroyed && !response.writableEnded) response.end(); });
  stream.pipe(response, { end: false });
  return {
    write(frame: string) {
      if (closed || ending || response.destroyed) return;
      const bytes = Buffer.byteLength(frame);
      // Large terminal source snapshots are legitimate. Still bound queued
      // plaintext and the slow client's compressed output independently.
      if (queuedBytes + bytes > 16 * 1048576 || response.writableLength > 1048576) { abort(); return; }
      queuedBytes += bytes;
      queue = queue.then(() => new Promise<void>((resolve, reject) => {
        if (closed) { resolve(); return; }
        stream.write(frame, error => {
          if (error) { reject(error); return; }
          stream.flush(encoding === "br" ? constants.BROTLI_OPERATION_FLUSH : constants.Z_SYNC_FLUSH, () => resolve());
        });
      })).then(() => { queuedBytes -= bytes; }, () => { queuedBytes -= bytes; abort(); });
    },
    async end() {
      if (closed) return;
      if (!ending) {
        ending = true;
        // This bounds transport drain only, never research execution.
        drainTimer = setTimeout(abort, 5000);
        drainTimer.unref();
        void queue.then(() => { if (!closed) stream.end(); });
      }
      await completed;
    },
  };
}
