import type { InterviewMarkdownEnvelope } from "./interview-markdown-api";

/** All readers share the report identity guard, including background/header GETs. */
function acceptsSource(previous: InterviewMarkdownEnvelope, next: InterviewMarkdownEnvelope): boolean {
  if (previous.interviewId !== next.interviewId) return false;
  if (previous.revisionId !== next.revisionId) return next.version > previous.version;
  const saved = previous.documents.find(doc => doc.step === "report");
  const incoming = next.documents.find(doc => doc.step === "report");
  return !saved || Boolean(incoming && incoming.version >= saved.version &&
    (incoming.version !== saved.version || (incoming.documentId === saved.documentId && incoming.contentHash === saved.contentHash)) &&
    (incoming.version <= saved.version || next.version > previous.version));
}

/** Memory owned by one authenticated interview layout; never a module singleton. */
export class InterviewSessionCache {
  private values = new Map<string, unknown>();
  private inflight = new Map<string, Promise<unknown>>();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private closed = false;
  private watches = new Map<string, { users: number; stop: () => void }>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get<T>(key: string): T | null { return (this.values.get(key) as T | undefined) ?? null; }
  put<T>(key: string, value: T): void {
    if (this.closed || value === null) return;
    const previous = this.values.get(key);
    const version = (item: unknown) => item && typeof item === "object" && "version" in item && typeof item.version === "number" ? item.version : null;
    const oldVersion = version(previous), nextVersion = version(value);
    if (oldVersion !== null && nextVersion !== null && nextVersion < oldVersion) return;
    if (key.startsWith("source/") && previous && !acceptsSource(previous as InterviewMarkdownEnvelope, value as InterviewMarkdownEnvelope)) return;
    if (Object.is(previous, value)) return;
    this.values.set(key, value);
    this.listeners.forEach(listener => listener());
  }
  read<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const epoch = this.epoch, before = this.values.get(key);
    const request = Promise.resolve().then(load).then(value => {
      // A mutation committed during this GET owns the snapshot until another GET.
      if (!this.closed && epoch === this.epoch && this.values.get(key) === before) this.put(key, value);
      return this.get<T>(key) ?? value;
    }).finally(() => { if (this.inflight.get(key) === request) this.inflight.delete(key); });
    this.inflight.set(key, request);
    return request;
  }
  resume(): void { this.closed = false; }
  retain(key: string, start: () => () => void): () => void {
    const entry = this.watches.get(key) ?? { users: 0, stop: start() };
    entry.users++; this.watches.set(key, entry);
    return () => { if (--entry.users === 0) { entry.stop(); this.watches.delete(key); } };
  }
  dispose(): void {
    this.closed = true; this.epoch++; this.values.clear(); this.inflight.clear();
    this.watches.forEach(entry => entry.stop()); this.watches.clear();
  }
}
