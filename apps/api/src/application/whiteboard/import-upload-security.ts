import { createHash } from 'node:crypto';
import { whiteboardImport as C } from '@repo/contracts';

type WhiteboardImportMime = ReturnType<typeof C.WhiteboardImportMime.parse>;
type WhiteboardImportUploadDescriptor = ReturnType<typeof C.WhiteboardImportUploadDescriptor.parse>;

export type WhiteboardImportScanFailure = 'SCAN_UNAVAILABLE' | 'CONTENT_REJECTED' | 'UPLOAD_CANCELLED' | 'INVALID_UPLOAD' | 'PAYLOAD_TOO_LARGE';

export class WhiteboardImportScanError extends Error {
  constructor(readonly code: WhiteboardImportScanFailure) {
    super(code);
    this.name = 'WhiteboardImportScanError';
  }
}

export interface WhiteboardImportScanSession {
  /** Resolves only after the scanner has accepted the chunk. Awaiting it is the backpressure boundary. */
  write(chunk: Uint8Array): Promise<void>;
  finish(): Promise<'clean' | 'rejected'>;
  abort(): Promise<void>;
}

export interface WhiteboardImportContentScanner {
  open(input: {
    mimeType: WhiteboardImportMime;
    declaredSizeBytes: number;
    declaredSha256: string;
    signal?: AbortSignal;
  }): Promise<WhiteboardImportScanSession>;
}

/** Missing scanner configuration is a security failure, never an implicit allow. */
export class FailClosedWhiteboardImportScanner implements WhiteboardImportContentScanner {
  async open(): Promise<WhiteboardImportScanSession> {
    throw new WhiteboardImportScanError('SCAN_UNAVAILABLE');
  }
}

/**
 * Local/self-hosted baseline content scanner. Hosted deployments can replace this port with
 * an ICAP/AV adapter without changing upload orchestration. It recognizes the standard EICAR
 * marker across chunk boundaries. Archive and active-content safety remain the parser/image
 * verifier's separate responsibility after this malware scan passes.
 */
export class BaselineWhiteboardImportScanner implements WhiteboardImportContentScanner {
  async open(): Promise<WhiteboardImportScanSession> {
    let tail = '';
    let rejected = false;
    return {
      async write(chunk) {
        const sample = `${tail}${Buffer.from(chunk).toString('latin1')}`;
        if (/EICAR-STANDARD-ANTIVIRUS-TEST-FILE/i.test(sample)) rejected = true;
        tail = sample.slice(-128);
      },
      async finish() { return rejected ? 'rejected' : 'clean'; },
      async abort() { tail = ''; rejected = true; },
    };
  }
}

export interface CollectedWhiteboardImport {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly sizeBytes: number;
}

const cancelled = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new WhiteboardImportScanError('UPLOAD_CANCELLED');
};

const abortable = async <T>(work: Promise<T>, signal?: AbortSignal): Promise<T> => {
  cancelled(signal);
  if (!signal) return work;
  let rejectAbort!: (reason: WhiteboardImportScanError) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(new WhiteboardImportScanError('UPLOAD_CANCELLED'));
  signal.addEventListener('abort', onAbort, { once: true });
  try { return await Promise.race([work, aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
};

/**
 * Pulls one chunk only after the scanner accepted the previous one. This bounds producer
 * pressure and gives cancellation a deterministic observation point without buffering a
 * second copy in the scanner adapter.
 */
export async function collectAndScanWhiteboardImport(
  source: AsyncIterable<Uint8Array>,
  descriptor: WhiteboardImportUploadDescriptor,
  scanner: WhiteboardImportContentScanner,
  signal?: AbortSignal,
): Promise<CollectedWhiteboardImport> {
  cancelled(signal);
  let session: WhiteboardImportScanSession;
  try {
    session = await abortable(scanner.open({
      mimeType: descriptor.mimeType,
      declaredSizeBytes: descriptor.sizeBytes,
      declaredSha256: descriptor.sha256,
      signal,
    }), signal);
  } catch (error) {
    if (error instanceof WhiteboardImportScanError) throw error;
    throw new WhiteboardImportScanError('SCAN_UNAVAILABLE');
  }
  const bytes = new Uint8Array(descriptor.sizeBytes);
  const digest = createHash('sha256');
  let sizeBytes = 0;
  const iterator = source[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await abortable(iterator.next(), signal);
      if (next.done) break;
      const unsafeChunk = next.value;
      cancelled(signal);
      if (!(unsafeChunk instanceof Uint8Array) || unsafeChunk.byteLength === 0) throw new WhiteboardImportScanError('INVALID_UPLOAD');
      const chunk = new Uint8Array(unsafeChunk);
      sizeBytes += chunk.byteLength;
      if (sizeBytes > C.WHITEBOARD_IMPORT_LIMITS.uploadBytes || sizeBytes > descriptor.sizeBytes) {
        throw new WhiteboardImportScanError(sizeBytes > C.WHITEBOARD_IMPORT_LIMITS.uploadBytes ? 'PAYLOAD_TOO_LARGE' : 'INVALID_UPLOAD');
      }
      await abortable(session.write(chunk), signal);
      cancelled(signal);
      digest.update(chunk);
      bytes.set(chunk, sizeBytes - chunk.byteLength);
    }
    cancelled(signal);
    if (await abortable(session.finish(), signal) !== 'clean') throw new WhiteboardImportScanError('CONTENT_REJECTED');
    const sha256 = digest.digest('hex');
    if (sizeBytes !== descriptor.sizeBytes || sha256 !== descriptor.sha256) throw new WhiteboardImportScanError('INVALID_UPLOAD');
    return { bytes, sha256, sizeBytes };
  } catch (error) {
    await iterator.return?.().catch(() => undefined);
    await session.abort().catch(() => undefined);
    if (error instanceof WhiteboardImportScanError) throw error;
    throw new WhiteboardImportScanError('SCAN_UNAVAILABLE');
  }
}
