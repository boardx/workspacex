import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, opendir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sessionLimits as L } from "./schema.js";
import { validateSessionPath } from "./paths.js";
import type { SessionExecutionProvider, SessionExecutionResult } from "./provider.js";

type FileInput = { path: string; contentBase64: string };
interface Session {
  root: string;
  token: string;
  expiresAt: number;
  busy: boolean;
  execution?: { id: string; abort: AbortController; done: Promise<SessionExecutionResult> };
  results: Map<string, { command: string; timeoutMs: number; result: SessionExecutionResult }>;
}

/** Metadata and capabilities are held by the trusted service, never inside mounted paths. */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly destroyed = new Map<string, { hash: Buffer; expiresAt: number; done: Promise<void>; settled: boolean }>();
  private creating = 0;
  private closing = 0;
  constructor(private readonly provider: SessionExecutionProvider, private readonly baseDir = tmpdir()) {}

  async create(skills: FileInput[] = [], ttlMs = L.defaultTtlMs!, inputs: FileInput[] = []) {
    this.reapTombstones();
    if (this.destroyed.size + this.sessions.size + this.creating >= L.maxSessions! * L.maxExecutionsPerSession!) throw new Error("SESSION_LIMIT");
    if (this.sessions.size + this.creating + this.closing >= L.maxSessions!) throw new Error("SESSION_LIMIT");
    if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > L.maxTtlMs! || skills.length > L.maxFiles! || inputs.length > L.maxFiles!) throw new Error("INVALID_SESSION_INPUT");
    const decodeFiles = (files: FileInput[], root: string) => files.map((file) => {
      validateSessionPath(file.path);
      if (!file.path.startsWith(`${root}/`)) throw new Error("INVALID_SESSION_PATH");
      return { path: file.path, bytes: decode(file.contentBase64) };
    });
    const decodedSkills = decodeFiles(skills, '/skills');
    const decoded = [...decodedSkills, ...decodeFiles(inputs, '/inputs')];
    if (new Set(decoded.map((f) => f.path)).size !== decoded.length ||
      decodedSkills.reduce((size, f) => size + f.bytes.length, 0) > L.maxSkillsBytes! ||
      Buffer.byteLength(JSON.stringify({ skills, inputs, ttlMs })) > L.maxRequestBytes!) throw new Error("INVALID_SESSION_INPUT");
    this.creating++;
    let root: string;
    try { root = await mkdtemp(join(this.baseDir, "wx-session-")); }
    catch (error) { this.creating--; throw error; }
    try {
      await mkdir(join(root, "workspace"));
      await mkdir(join(root, "skills"));
      await mkdir(join(root, "inputs"));
      for (const file of decoded) {
        const target = join(root, file.path.slice(1));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.bytes, { mode: 0o400, flag: "wx" });
      }
      const sessionId = randomUUID();
      const token = randomBytes(32).toString("hex");
      const expiresAt = Date.now() + ttlMs;
      this.sessions.set(sessionId, { root, token, expiresAt, busy: false, results: new Map() });
      return { sessionId, token, expiresAt };
    } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
    finally { this.creating--; }
  }

  private get(id: string, token: string): Session {
    const session = this.sessions.get(id);
    const actual = Buffer.from(token);
    if (!session || actual.length !== session.token.length || !timingSafeEqual(actual, Buffer.from(session.token))) {
      throw new Error("SESSION_NOT_FOUND");
    }
    if (session.expiresAt <= Date.now()) throw new Error("SESSION_EXPIRED");
    return session;
  }

  private async exclusive<T>(session: Session, operation: () => Promise<T>): Promise<T> {
    if (session.busy) throw new Error("SESSION_BUSY");
    session.busy = true;
    try { return await operation(); } finally { session.busy = false; }
  }

  private async resolve(session: Session, path: string, writable = false): Promise<string> {
    validateSessionPath(path, writable);
    let current = session.root;
    for (const part of path.slice(1).split("/")) {
      current = join(current, part);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || stat.nlink > 1 && stat.isFile()) {
          throw new Error("INVALID_SESSION_PATH");
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return current;
  }

  async write(id: string, token: string, file: FileInput) {
    const session = this.get(id, token);
    return this.exclusive(session, async () => {
      const bytes = decode(file.contentBase64);
      const target = await this.resolve(session, file.path, true);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      return { path: file.path, sizeBytes: bytes.length };
    });
  }

  async read(id: string, token: string, path: string) {
    const session = this.get(id, token);
    return this.exclusive(session, async () => {
      const target = await this.resolve(session, path);
      if ((await lstat(target)).size > L.maxFileBytes!) throw new Error("SESSION_FILE_TOO_LARGE");
      const bytes = await readFile(target);
      return { path, contentBase64: bytes.toString("base64"), sizeBytes: bytes.length };
    });
  }

  async list(id: string, token: string, path: string) {
    const session = this.get(id, token);
    return this.exclusive(session, async () => {
      const target = await this.resolve(session, path);
      const entries = [];
      for await (const entry of await opendir(target)) {
        if (entries.length >= L.maxDirectoryEntries!) throw new Error("SESSION_LIMIT");
        const virtual = `${path}/${entry.name}`;
        const stat = await lstat(await this.resolve(session, virtual));
        entries.push({ path: virtual, isDirectory: stat.isDirectory(), sizeBytes: stat.size });
      }
      return { entries: entries.sort((a, b) => a.path.localeCompare(b.path)) };
    });
  }

  async execute(id: string, token: string, input: { executionId: string; command: string; timeoutMs: number }) {
    const session = this.get(id, token);
    if (!input.executionId || input.executionId.length > 128 || typeof input.command !== "string" ||
      !input.command || Buffer.byteLength(input.command) > L.maxCommandBytes! || !Number.isInteger(input.timeoutMs) ||
      input.timeoutMs < 1 || input.timeoutMs > L.maxTimeoutMs!) throw new Error("INVALID_SESSION_INPUT");
    const old = session.results.get(input.executionId);
    if (old) {
      if (old.command !== input.command || old.timeoutMs !== input.timeoutMs) throw new Error("SESSION_EXECUTION_CONFLICT");
      return old.result;
    }
    if (session.results.size >= L.maxExecutionsPerSession!) throw new Error("SESSION_LIMIT");
    return this.exclusive(session, async () => {
      const abort = new AbortController();
      // Schedule work after pending state is visible, including during asynchronous probe.
      const done = Promise.resolve().then(async () => {
        const available = await this.provider.probe();
        if (abort.signal.aborted || session.expiresAt <= Date.now()) {
          return { executionId: input.executionId, exitCode: null, output: "", truncated: false,
            timedOut: session.expiresAt <= Date.now(), cancelled: abort.signal.aborted };
        }
        if (!available) throw new Error("SESSION_EXECUTION_UNAVAILABLE");
        return this.provider.execute({ ...input, timeoutMs: Math.min(input.timeoutMs, session.expiresAt - Date.now()),
          workspace: join(session.root, "workspace"), skills: join(session.root, "skills"), inputs: join(session.root, "inputs"), signal: abort.signal });
      });
      session.execution = { id: input.executionId, abort, done };
      try {
        const result = await done;
        session.results.set(input.executionId, { ...input, result });
        return result;
      } finally { session.execution = undefined; }
    });
  }

  cancel(id: string, token: string, executionId: string) {
    const session = this.get(id, token);
    const cancelled = session.execution?.id === executionId;
    if (cancelled) session.execution?.abort.abort();
    return { cancelled };
  }

  private reapTombstones() {
    for (const [id, value] of this.destroyed) if (value.settled && value.expiresAt <= Date.now()) this.destroyed.delete(id);
  }

  async destroy(id: string, token: string) {
    this.reapTombstones();
    const tombstone = this.destroyed.get(id);
    if (tombstone) {
      const hash = createHash("sha256").update(token).digest();
      if (!timingSafeEqual(hash, tombstone.hash)) throw new Error("SESSION_NOT_FOUND");
      await tombstone.done;
      return { deleted: true as const };
    }
    const session = this.get(id, token);
    if (session.busy && !session.execution) throw new Error("SESSION_BUSY");
    this.sessions.delete(id);
    const value = { hash: createHash("sha256").update(token).digest(), expiresAt: session.expiresAt,
      done: Promise.resolve(), settled: false };
    this.destroyed.set(id, value);
    value.done = this.close(session).finally(() => { value.settled = true; });
    await value.done;
    return { deleted: true as const };
  }

  private async close(session: Session): Promise<void> {
    this.closing++;
    try {
      if (session.execution) { session.execution.abort.abort(); await session.execution.done.catch(() => undefined); }
      await rm(session.root, { recursive: true, force: true });
    } finally { this.closing--; }
  }

  /** Called by the service timer; no caller capability is needed for expired resources. */
  async reapExpired(): Promise<void> {
    this.reapTombstones();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt > Date.now()) continue;
      if (session.busy && !session.execution) continue;
      this.sessions.delete(id);
      await this.close(session);
    }
  }
}

function decode(content: string): Buffer {
  if (typeof content !== "string" || content.length > 4 * Math.ceil(L.maxFileBytes! / 3) || content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
    throw new Error("INVALID_SESSION_INPUT");
  }
  const bytes = Buffer.from(content, "base64");
  if (bytes.toString("base64") !== content) throw new Error("INVALID_SESSION_INPUT");
  if (bytes.length > L.maxFileBytes!) throw new Error("SESSION_FILE_TOO_LARGE");
  return bytes;
}
