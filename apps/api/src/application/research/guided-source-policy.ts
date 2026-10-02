import { ResearchRuntimeError, type ResearchRuntime } from "./guided-runtime-ports";
type Policy = NonNullable<ResearchRuntime["sourcePolicy"]>;
const internalIdPrefix = "internal:";
const internalOrigin = "https://internal.workspacex.local";
export function sourcePolicyDomains(policy: Policy): string[] {
  if (policy.mode === "restrict" && !policy.domains.length) throw new ResearchRuntimeError("RESEARCH_SOURCE_POLICY_INVALID");
  return policy.domains.map((value) => {
    const host = value.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]!.replace(/^www\./, "");
    if (!host || !/^[a-z0-9.-]+$/.test(host) || host.includes("..")) throw new ResearchRuntimeError("RESEARCH_SOURCE_URL_INVALID");
    return host;
  });
}
export function internalSourceReference(id: string) {
  return { id: `${internalIdPrefix}${id}`, url: `${internalOrigin}/artifacts/${encodeURIComponent(id)}` };
}
export function sourceAllowedByPolicy(source: { url: string; id?: string }, policy?: Policy): boolean {
  if (!policy || policy.mode !== "restrict") return true;
  const domains = sourcePolicyDomains(policy);
  if (policy.internalSourceIds.some((id) => {
    const reference = internalSourceReference(id);
    return source.id === reference.id && source.url === reference.url;
  })) return true;
  const url = new URL(source.url);
  if (source.id?.startsWith(internalIdPrefix) || url.hostname.replace(/\.$/, "") === new URL(internalOrigin).hostname) return false;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
