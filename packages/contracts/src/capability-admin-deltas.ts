/** Review-only deltas over existing operations. No production export or route replacement. */
import { z } from "zod";
import { operations as existing } from "./agent-runtime";
import { CapabilityModelConfigRef, McpCredentialMutation } from "./capability-runtime-policy";

const ConfigRevision = CapabilityModelConfigRef.shape.configRevision;
const ProviderKey = z.string().trim().min(1).max(200);
const UpstreamModelId = z.string().trim().min(1).max(500);
const registration = existing.registerModel.in.extend({ providerKey: ProviderKey.optional(), upstreamModelId: UpstreamModelId.optional() }).strict()
  .superRefine((input, context) => {
    if (input.shape === "single" && (!input.providerKey || !input.upstreamModelId || input.members.length !== 0)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "single model requires runtime mapping and no composite members" });
    }
    if (input.shape === "composite" && (input.providerKey !== undefined || input.upstreamModelId !== undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "composite model cannot masquerade as a single provider binding" });
    }
  });
const configurePatch = existing.configureModel.in.shape.patch.extend({ providerKey: ProviderKey.optional(), upstreamModelId: UpstreamModelId.optional() }).strict()
  .refine(patch => Object.keys(patch).length > 0, "empty configuration patch is not a change");

export const operations = {
  registerModel: { ...existing.registerModel, in: registration,
    out: existing.registerModel.out.extend({ configRevision: ConfigRevision }).strict() },
  configureModel: { ...existing.configureModel,
    // Stored shape is checked by the application; client cannot change it via this patch.
    in: existing.configureModel.in.extend({ expectedVersion: ConfigRevision, patch: configurePatch }).strict(),
    out: existing.configureModel.out.extend({ configRevision: ConfigRevision }).strict(),
    err: existing.configureModel.err.filter(code => code !== "RETEST_REQUIRED") },
  probeConnectivity: { ...existing.probeConnectivity,
    in: existing.probeConnectivity.in.extend({ configRevision: ConfigRevision }).strict(),
    out: existing.probeConnectivity.out.extend({ modelConfigRef: CapabilityModelConfigRef }).strict()
      .refine(result => result.reachable === (result.failureKind === null), "probe failure must retain its reason"),
    err: [...existing.probeConnectivity.err, "VERSION_CHANGED"] as const },
  recordAdmissionTest: { ...existing.recordAdmissionTest,
    in: existing.recordAdmissionTest.in.extend({ configRevision: ConfigRevision }).strict(),
    out: existing.recordAdmissionTest.out.extend({ configRevision: ConfigRevision }).strict(),
    err: [...existing.recordAdmissionTest.err, "VERSION_CHANGED"] as const },
  enableModel: { ...existing.enableModel,
    in: existing.enableModel.in.extend({ expectedVersion: ConfigRevision }).strict(),
    out: existing.enableModel.out.extend({ configRevision: ConfigRevision }).strict() },
  discoverRemoteMcpTools: { ...existing.discoverRemoteMcpTools,
    // Proposed new server config CAS, not a claim that current reconnect implements concurrency control.
    in: existing.discoverRemoteMcpTools.in.omit({ credential: true }).extend({
      credentialMutation: McpCredentialMutation, expectedConfigRevision: ConfigRevision,
    }).strict(),
    out: existing.discoverRemoteMcpTools.out.extend({ credentialConfigured: z.boolean(), configRevision: ConfigRevision }).strict(),
    err: [...existing.discoverRemoteMcpTools.err, "VERSION_CHANGED", "MCP_CREDENTIAL_UNAVAILABLE", "MCP_AUTHENTICATION_FAILED"] as const },
} as const;
