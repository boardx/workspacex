import { z } from "zod";

/** Preserve graph/http routing from its single source while removing developer env loading. */
export function agentReleaseConfig(source: unknown, baseImage: string, revision: string) {
  const config = z.object({ dependencies: z.array(z.string()), graphs: z.record(z.string()), http: z.object({ app: z.string() }).passthrough(), env: z.unknown().optional() }).strict().parse(source);
  if (!/^langchain\/langgraph-(?:api|server)@sha256:[a-f0-9]{64}$/.test(baseImage)) throw new Error("AGENT_BASE_IMAGE_DIGEST_REQUIRED");
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("SOURCE_REVISION_REQUIRED");
  const { env: _developerEnvironment, ...runtime } = config;
  return { ...runtime, base_image: baseImage, python_version: "3.11", dockerfile_lines: [`LABEL org.opencontainers.image.revision="${revision}"`] };
}

/** No network or license validation here; readiness must verify the real licensed server. */
export function validateAgentServerEnvironment(env: NodeJS.ProcessEnv) {
  const required = ["DATABASE_URI", "REDIS_URI", "LANGGRAPH_CLOUD_LICENSE_KEY"];
  const missing = required.filter(key => !env[key]?.trim());
  if (missing.length) throw new Error(`AGENT_SERVER_ENV_REQUIRED: ${missing.join(", ")}`);
  if (!/^postgres(?:ql)?:\/\//.test(env.DATABASE_URI!)) throw new Error("AGENT_DATABASE_URI_INVALID");
  if (!/^rediss?:\/\//.test(env.REDIS_URI!)) throw new Error("AGENT_REDIS_URI_INVALID");
  return { configured: true, licenseVerified: false };
}
