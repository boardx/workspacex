/** Review-only deltas over existing operations. No production export or route replacement. */
import { z } from "zod";
import { AgentRuntimeError, operations as existing } from "./agent-runtime";
import { CapabilityModelConfigRef, CapabilityModelRuntimeBinding, McpCredentialMutation } from "./capability-runtime-policy";

const ConfigRevision = CapabilityModelConfigRef.shape.configRevision;
const ProviderKey = CapabilityModelRuntimeBinding.shape.providerKey;
const UpstreamModelId = CapabilityModelRuntimeBinding.shape.upstreamModelId;
/** Proposed closed error delta. The exception filter must adopt it with these operations. */
const McpAdminError = z.enum(["MCP_CREDENTIAL_UNAVAILABLE", "MCP_AUTHENTICATION_FAILED"]);
export const CapabilityAdminError = z.enum([...AgentRuntimeError.options, ...existing.discoverRemoteMcpTools.err, ...McpAdminError.options]);
const registration = existing.registerModel.in.extend({ providerKey: ProviderKey.optional(), upstreamModelId: UpstreamModelId.optional() }).strict()
  .superRefine((input, context) => {
    if (input.shape === "single" && (!input.providerKey || !input.upstreamModelId || input.members.length !== 0)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "single model requires runtime mapping and no composite members" });
    }
    if (input.shape === "composite" && (input.providerKey !== undefined || input.upstreamModelId !== undefined || input.members.length === 0 || input.members.some(member => !member.modelId.trim() || !member.role.trim()))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "composite requires named members and cannot carry a single provider binding" });
    }
  });
const configurePatch = existing.configureModel.in.shape.patch.extend({ providerKey: ProviderKey.optional(), upstreamModelId: UpstreamModelId.optional() }).strict()
  .refine(patch => Object.keys(patch).length > 0, "empty configuration patch is not a change");

export const operations = {
  listMcpServers: { ...existing.listMcpServers,
    out: z.array(existing.listMcpServers.out.element.extend({ configRevision: ConfigRevision }).strict()) },
  listModelPool: { ...existing.listModelPool,
    out: z.array(existing.listModelPool.out.element.extend({ configRevision: ConfigRevision,
      providerKey: ProviderKey.optional(), upstreamModelId: UpstreamModelId.optional() }).strict()
      .refine(row => row.shape === "single" ? Boolean(row.providerKey && row.upstreamModelId) : row.providerKey === undefined && row.upstreamModelId === undefined,
        "only single pool rows carry a required provider/upstream mapping")) },
  listSelectableModels: { ...existing.listSelectableModels,
    out: z.array(existing.listSelectableModels.out.element.extend({ configRevision: ConfigRevision }).strict()) },
  routeModelCall: { ...existing.routeModelCall,
    in: existing.routeModelCall.in.extend({ requestedConfigRevision: ConfigRevision.nullable() }).strict()
      .refine(input => (input.requestedModelId === null) === (input.requestedConfigRevision === null), "requested model and revision must be selected together"),
    out: existing.routeModelCall.out.extend({ modelBinding: CapabilityModelRuntimeBinding }).strict()
      .refine(result => result.modelBinding.capabilityModelId === (result.degradedTo ?? result.selectedModelId), "binding must identify the actual routed model") },
  listModelReferences: { ...existing.listModelReferences,
    out: existing.listModelReferences.out.extend({ modelConfigRef: CapabilityModelConfigRef }).strict() },
  disableModel: { ...existing.disableModel,
    in: existing.disableModel.in.extend({ expectedVersion: ConfigRevision }).strict(),
    out: existing.disableModel.out.extend({ modelConfigRef: CapabilityModelConfigRef }).strict() },
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
    err: [...existing.discoverRemoteMcpTools.err, "VERSION_CHANGED", ...McpAdminError.options] as const,
    errorContract: CapabilityAdminError },
} as const;

/** Request and response schemas alone cannot establish correlation. Validate the pair at the adapter boundary. */
export const modelEvidenceExchanges = {
  probeConnectivity: z.object({ request: operations.probeConnectivity.in, response: operations.probeConnectivity.out }).strict()
    .refine(({ request, response }) => request.modelId === response.modelConfigRef.capabilityModelId && request.configRevision === response.modelConfigRef.configRevision,
      "probe result must identify the requested model configuration"),
  recordAdmissionTest: z.object({ request: operations.recordAdmissionTest.in, response: operations.recordAdmissionTest.out }).strict()
    .refine(({ request, response }) => request.modelId === response.modelId && request.configRevision === response.configRevision && request.item === response.item && request.verdict === response.verdict && request.evidence === response.evidence,
      "admission record must match the submitted model configuration and judgment"),
  enableModel: z.object({ request: operations.enableModel.in, response: operations.enableModel.out }).strict()
    .refine(({ request, response }) => request.modelId === response.modelId && request.expectedVersion === response.configRevision && response.status === "已启用",
      "enable response must identify the enabled requested configuration"),
} as const;
