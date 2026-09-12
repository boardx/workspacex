/** Validate only the backing services used by the repository-owned Agent runtime. */
export function validateAgentServerEnvironment(env: NodeJS.ProcessEnv) {
  const required = ["DATABASE_URI", "REDIS_URI"];
  const missing = required.filter(key => !env[key]?.trim());
  if (missing.length) throw new Error(`AGENT_SERVER_ENV_REQUIRED: ${missing.join(", ")}`);
  if (!/^postgres(?:ql)?:\/\//.test(env.DATABASE_URI!)) throw new Error("AGENT_DATABASE_URI_INVALID");
  if (!/^rediss?:\/\//.test(env.REDIS_URI!)) throw new Error("AGENT_REDIS_URI_INVALID");
  return { configured: true, runtime: "self-hosted" as const };
}
