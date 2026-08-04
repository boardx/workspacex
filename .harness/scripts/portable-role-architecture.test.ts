import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { REPO_ROOT } from "./lib/paths";

interface Role {
  id: string;
  kind: "coordinator" | "worker" | "reviewer";
  merge_authority: boolean;
  dispatch_authority: boolean;
}

interface Contract {
  version: number;
  status: string;
  owner_issue: number;
  canonical_sources: {
    role_behavior: { path_glob: string; generated_surfaces: Record<string, string> };
    runtime_role: { system: string; prerequisite_issue: number; prerequisite_pr: number };
    runtime_actor: { field: string; format: string };
  };
  stable_roles: Role[];
  identity_resolution: {
    directory_match_count: string;
    validate_fields: string[];
    output_environment: string;
    output_value: string;
    fail_closed_on: string[];
  };
  credentials: {
    cache_path: string;
    required_mode: string;
    forbidden_channels: string[];
    write_protocol: string;
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
    });
    expect(contract.canonical_sources.runtime_actor).toEqual({
      field: "directory_agent_id",
      format: "immutable-directory-ulid",
    });
  });

  it("defines the six initial roles with one merge authority and coordinator-only dispatch", () => {
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
    expect(contract.stable_roles.filter((role) => role.dispatch_authority).every((role) => role.kind === "coordinator")).toBe(true);
  });

  it("fails closed during role resolution and keeps credentials local with mode 0600", () => {
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
      cache_path: ".harness/state/.cache/coord-credentials.json",
      required_mode: "0600",
      write_protocol: "temp-file-chmod-0600-atomic-rename",
    });
    expect(contract.credentials.forbidden_channels).toEqual(
      expect.arrayContaining(["argv", "logs", "tracked-files", "generated-surfaces"]),
    );
    const gitignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
    expect(gitignore).toContain(".harness/state/.cache/");
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
