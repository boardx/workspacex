/** Validate caller-supplied production DSNs before adding container certificate paths.
 * libpq accepts query parameters which override URI authority fields and uses the LAST
 * repeated sslmode. A URL.get() check alone therefore cannot enforce TLS or identity.
 */
export function validateProductionAgentPersistence(input: {
  DATABASE_URI: string;
  MEMORY_STORE_DATABASE_URL: string;
  MEMORY_STORE_MIGRATION_DATABASE_URL: string;
}, sslMode: "verify-full" | "disable" = "verify-full"): void {
  try {
    const parse = (value: string) => {
      const uri = new URL(value);
      const entries = [...uri.searchParams.entries()];
      if (!/^postgres(?:ql)?:$/.test(uri.protocol) || !uri.hostname || !uri.username || !uri.password ||
        !uri.pathname.slice(1) || uri.hash || entries.length !== 1 ||
        entries[0]![0] !== "sslmode" || entries[0]![1] !== sslMode) throw new Error();
      return { uri, user: decodeURIComponent(uri.username), password: decodeURIComponent(uri.password), database: decodeURIComponent(uri.pathname.slice(1)) };
    };
    const graph = parse(input.DATABASE_URI);
    const memory = parse(input.MEMORY_STORE_DATABASE_URL);
    const owner = parse(input.MEMORY_STORE_MIGRATION_DATABASE_URL);
    if (memory.user !== "memory_rw" || owner.user !== "memory_owner" ||
      new Set(["app_rw", "app_diag_ro", memory.user, owner.user]).has(graph.user)) throw new Error();
    if (new Set([graph.password, memory.password, owner.password]).size !== 3) throw new Error();
    if (memory.uri.hostname !== owner.uri.hostname ||
      (memory.uri.port || "5432") !== (owner.uri.port || "5432") || memory.database !== owner.database) throw new Error();
  } catch {
    // Never return URL parser messages, supplied credentials, or an error cause.
    throw new Error("AGENT_PERSISTENCE_CONFIGURATION_INVALID");
  }
}
