import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { REPO_ROOT } from "./lib/paths";

interface Role {
  id: string;
  kind: "coordinator" | "architecture-coordinator" | "module-coordinator" | "worker" | "reviewer";
  merge_authority: boolean;
  dispatch_authority: boolean;
}

interface Contract {
  version: number;
  status: string;
  owner_issue: number;
  canonical_sources: {
    role_behavior: { path_glob: string; generated_surfaces: Record<string, string> };
    runtime_role: {
      system: string;
      prerequisite_issue: number;
      prerequisite_pr: number;
      kind_enum_source: string;
      checked_projection: string;
      stable_role_binding_owner: string;
    };
    runtime_actor: { field: string; format: string };
  };
  stable_roles: Role[];
  identity_resolution: {
    input: string[];
    canonical_lookup: {
      mapping: string;
      uniqueness_boundary: string;
      mutable_agent_name_is_identity_input: boolean;
      same_role_different_projects: string;
      same_project_same_role_different_owners: string;
      agent_rename_preserves_binding: boolean;
    };
    directory_match_count: string;
    validate_fields: string[];
    output_environment: string;
    output_value: string;
    fail_closed_on: string[];
  };
  credentials: {
    legacy_migration_source: string;
    metadata_cache_path: string;
    metadata_cache_required_mode: string;
    secret_store: string;
    launcher_trust_boundary: string;
    process_delivery: string;
    agent_secret_enumeration: string;
    agent_legacy_cache_access: string;
    cross_role_secret_request: string;
    forbidden_channels: string[];
    metadata_write_protocol: string;
  };
  model_session_policy: {
    owner: string;
    role_spec_forbidden_fields: string[];
    generated_role_pins_model: boolean;
    default_behavior: string;
    overrides_may_change: string[];
    overrides_must_not_change: string[];
    identity_impact: string;
  };
  session_protocol: {
    actor: string;
    ordered_steps: string[];
    leases: { role: string; issue: string };
    lost_lease_behavior: string;
  };
  implementation_dag: Array<{ issue: number; depends_on: number[]; deliverable: string }>;
  excluded_coordination_tasks: number[];
}

const contractPath = join(REPO_ROOT, ".harness", "contracts", "portable-role-runtime.yaml");
const contract = parse(readFileSync(contractPath, "utf8")) as Contract;
const registry = parse(
  readFileSync(join(REPO_ROOT, ".harness", "agents", "registry.yaml"), "utf8"),
) as { agents: Array<{ id: string; kind: string }>; reviewers: Array<{ id: string; kind: string }> };
const projectedKinds = new Map(
  [...registry.agents, ...registry.reviewers].map((role) => [role.id, role.kind]),
);

function roleIdentityFingerprint(role: Role): string {
  return JSON.stringify({
    id: role.id,
    kind: role.kind,
    merge_authority: role.merge_authority,
    dispatch_authority: role.dispatch_authority,
  });
}

interface RoleBindingProbe {
  project: string;
  role: string;
  owner: string;
  agentId: string;
  name: string;
  active: boolean;
}

function tryActiveRoleBinding(existing: RoleBindingProbe[], candidate: RoleBindingProbe): boolean {
  const collision = existing.some(
    (binding) => binding.active && candidate.active &&
      binding.project === candidate.project && binding.role === candidate.role,
  );
  if (collision) return false;
  existing.push(candidate);
  return true;
}

describe("#436 portable persistent role architecture contract", () => {
  it("separates role behavior, Directory runtime role, and immutable runtime actor", () => {
    expect(contract).toMatchObject({ version: 1, status: "proposed-design", owner_issue: 436 });
    expect(contract.canonical_sources.role_behavior.path_glob).toBe(".harness/agents/roles/*.yaml");
    expect(contract.canonical_sources.role_behavior.generated_surfaces).toEqual({
      claude_code: ".claude/agents/<stable-role-id>.md",
      codex: ".codex/agents/<stable-role-id>.toml",
    });
    expect(contract.canonical_sources.runtime_role).toMatchObject({
      system: "PlatformDirectory",
      prerequisite_issue: 396,
      prerequisite_pr: 402,
      kind_enum_source: "packages/coord-directory/src/directory.ts#AGENT_KINDS",
      checked_projection: ".harness/agents/registry.yaml",
      stable_role_binding_owner: "PlatformDirectory enrollment",
    });
    expect(contract.canonical_sources.runtime_actor).toEqual({
      field: "directory_agent_id",
      format: "immutable-directory-ulid",
    });
  });

  it("matches the checked Directory projection and catches a kind normalization counterexample", () => {
    expect(contract.stable_roles.map((role) => role.id)).toEqual([
      "coord-main",
      "coord-architecture",
      "dev-chat-e2e",
      "dev-ai-runtime",
      "rev-feature",
      "rev-e2e",
    ]);
    expect(contract.stable_roles.filter((role) => role.merge_authority).map((role) => role.id)).toEqual([
      "coord-main",
    ]);
    for (const role of contract.stable_roles) {
      expect(role.kind, role.id).toBe(projectedKinds.get(role.id));
    }
    expect(contract.stable_roles.find((role) => role.id === "coord-architecture")?.kind).toBe(
      "architecture-coordinator",
    );
    expect("coordinator").not.toBe(projectedKinds.get("coord-architecture"));
    expect(
      contract.stable_roles
        .filter((role) => role.dispatch_authority)
        .every((role) => ["coordinator", "architecture-coordinator", "module-coordinator"].includes(role.kind)),
    ).toBe(true);
  });

  it("uses a Directory-owned project role binding and rejects cross-owner duplicates without depending on mutable names", () => {
    expect(contract.identity_resolution.input).toEqual(["project-slug", "stable-role-id"]);
    expect(contract.identity_resolution.canonical_lookup).toMatchObject({
      mapping: "(project_id, stable_role_id)->agent_id",
      uniqueness_boundary: "one-active-agent-per-project-and-stable-role",
      mutable_agent_name_is_identity_input: false,
      same_role_different_projects: "allowed",
      same_project_same_role_different_owners: "rejected",
      agent_rename_preserves_binding: true,
    });
    const bindings: RoleBindingProbe[] = [];
    const first = {
      project: "project-a", role: "dev-chat-e2e", owner: "owner-a",
      agentId: "immutable-id", name: "old", active: true,
    };
    expect(tryActiveRoleBinding(bindings, first)).toBe(true);
    expect(tryActiveRoleBinding(bindings, {
      ...first, owner: "owner-b", agentId: "other-id", name: "same-role-other-owner",
    })).toBe(false);
    expect(tryActiveRoleBinding(bindings, {
      ...first, project: "project-b", owner: "owner-b", agentId: "project-b-id",
    })).toBe(true);
    const beforeRename = first;
    const afterRename = { ...beforeRename, name: "new" };
    expect([afterRename.project, afterRename.role]).toEqual([beforeRename.project, beforeRename.role]);
    expect(afterRename.agentId).toBe(beforeRename.agentId);
  });

  it("fails closed during role resolution and never exposes the legacy all-role cache to an agent", () => {
    expect(contract.identity_resolution.directory_match_count).toBe("exactly-one-active");
    expect(contract.identity_resolution.validate_fields).toEqual(["kind", "areas", "reports_to"]);
    expect(contract.identity_resolution.output_environment).toBe("COORD_AGENT_ID");
    expect(contract.identity_resolution.output_value).toBe("directory-agent-ulid");
    expect(contract.identity_resolution.fail_closed_on).toEqual(
      expect.arrayContaining([
        "no-active-directory-match",
        "multiple-active-directory-matches",
        "credential-mode-not-0600",
        "token-directory-agent-mismatch",
      ]),
    );
    expect(contract.credentials).toMatchObject({
      legacy_migration_source: ".harness/state/.cache/coord-credentials.json",
      metadata_cache_path: ".harness/state/.cache/coord-credential-refs/<stable-role-id>.json",
      metadata_cache_required_mode: "0600",
      secret_store: "os-credential-broker",
      launcher_trust_boundary: "outside-agent-process",
      process_delivery: "selected-role-only",
      agent_secret_enumeration: "denied",
      agent_legacy_cache_access: "denied",
      cross_role_secret_request: "denied-with-human-or-broker-auth",
      metadata_write_protocol: "temp-file-chmod-0600-atomic-rename",
    });
    expect(contract.credentials.forbidden_channels).toEqual(
      expect.arrayContaining(["argv", "logs", "tracked-files", "generated-surfaces"]),
    );
    const gitignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
    expect(gitignore).toContain(".harness/state/.cache/");
    const selectedRole = "dev-chat-e2e";
    const deliveredSecretRoles = contract.credentials.process_delivery === "selected-role-only"
      ? [selectedRole]
      : contract.stable_roles.map((role) => role.id);
    expect(deliveredSecretRoles).toEqual(["dev-chat-e2e"]);
    expect(deliveredSecretRoles).not.toContain("coord-main");
  });

  it("keeps model/session policy orthogonal to role identity and authority", () => {
    expect(contract.model_session_policy).toMatchObject({
      owner: "tool-or-session-configuration",
      generated_role_pins_model: false,
      default_behavior: "inherit-tool-session-model",
      identity_impact: "none",
    });
    expect(contract.model_session_policy.role_spec_forbidden_fields).toEqual(
      expect.arrayContaining(["model", "claude_model", "codex_model"]),
    );
    expect(contract.model_session_policy.overrides_must_not_change).toEqual(
      expect.arrayContaining(["stable-role-id", "directory-agent-ulid", "kind", "authority"]),
    );
    const role = contract.stable_roles.find((candidate) => candidate.id === "dev-chat-e2e")!;
    const before = roleIdentityFingerprint(role);
    const sessionA = { model: "tool-default-a", reasoningEffort: "low" };
    const sessionB = { model: "tool-default-b", reasoningEffort: "high" };
    expect(sessionA).not.toEqual(sessionB);
    expect(roleIdentityFingerprint(role)).toBe(before);
    expect(Object.hasOwn(role, "model")).toBe(false);
  });

  it("orders inbox, ACK, dual leases, heartbeat, and durable handoff under the Directory actor", () => {
    expect(contract.session_protocol.actor).toBe("directory-agent-ulid");
    expect(contract.session_protocol.ordered_steps).toEqual([
      "acquire-role-lease",
      "poll-private-inbox",
      "ack-task",
      "acquire-issue-lease",
      "heartbeat-role-and-issue-leases",
      "write-handoff",
      "release-issue-lease",
      "release-role-lease",
    ]);
    expect(contract.session_protocol.leases).toEqual({
      role: "role:<stable-role-id>",
      issue: "issue:<github-issue-number>",
    });
    expect(contract.session_protocol.lost_lease_behavior).toBe("stop-writes-and-fail-closed");
  });

  it("makes the child implementation DAG executable and explicitly excludes Task #44", () => {
    expect(contract.implementation_dag).toEqual([
      { issue: 441, depends_on: [436], deliverable: "portable-generated-role-surfaces" },
      { issue: 442, depends_on: [436, 396], deliverable: "scoped-identity-verification-endpoint" },
      { issue: 443, depends_on: [441, 442, 396], deliverable: "stable-role-resolver-and-credential-bootstrap" },
      { issue: 445, depends_on: [443], deliverable: "persistent-role-session-loop" },
      { issue: 444, depends_on: [441, 443, 445], deliverable: "secret-and-authority-drift-ci-gates" },
      { issue: 446, depends_on: [441, 442, 443, 444, 445], deliverable: "dual-tool-dev-chat-e2e-acceptance" },
    ]);
    expect(contract.excluded_coordination_tasks).toContain(44);
  });
});
