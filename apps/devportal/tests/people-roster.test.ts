// W5 /p/:slug/people 花名册接真：lib/people-roster.ts 纯函数 buildRoster 的聚合行为。
import { describe, expect, it } from "vitest";
import { buildRoster, ownerToGithubLogin, rosterCounts } from "../lib/people-roster";
import type { DirectoryEngineer, DirectoryMembership } from "../lib/directory";
import type { CoordLease } from "../lib/coord-gateway";

const NOW = Date.parse("2026-09-26T12:00:00Z");

function mem(p: Partial<DirectoryMembership> & Pick<DirectoryMembership, "engineer_id" | "role">): DirectoryMembership {
  return {
    membership_id: `m-${p.engineer_id}`, project_id: "p1", status: "active", modules: [], intro: "",
    onboarding_issue_url: null, created_at: "", updated_at: "", project_slug: "boardx", ...p,
  };
}
const eng = (id: string, handle: string, login: string | null, name = ""): DirectoryEngineer => ({
  engineer_id: id, handle, display_name: name, github_login: login,
});
const lease = (agent: string, minAgo: number): CoordLease => ({
  lease_id: `l-${agent}`, resource_id: `F-${agent}`, agent_id: agent,
  claimed_at: "", last_heartbeat_at: new Date(NOW - minAgo * 60_000).toISOString(), ttl_seconds: 10_800,
});

describe("ownerToGithubLogin", () => {
  it("归一 noreply 邮箱与裸 login，其他邮箱拒绝", () => {
    expect(ownerToGithubLogin("2325074+usamshen@users.noreply.github.com")).toBe("usamshen");
    expect(ownerToGithubLogin("LiChen")).toBe("lichen");
    expect(ownerToGithubLogin("a@b.com")).toBeNull();
    expect(ownerToGithubLogin(undefined)).toBeNull();
  });
});

describe("buildRoster", () => {
  const engineers = [eng("e1", "usam", "usamshen", "Usam Shen"), eng("e2", "lichen", "lichen"), eng("e3", "ghost", null)];
  const registry = [
    { id: "coord-main", owner: "2325074+usamshen@users.noreply.github.com" },
    { id: "coord-main.reviewer", owner: "2325074+usamshen@users.noreply.github.com" },
    { id: "retired", owner: "usamshen", active: false },
    { id: "module-collab", owner: "lichen" },
    { id: "unowned-decoy", owner: "ghost" },
  ];

  it("只取 active 成员，按角色排序，agent 按 github_login 归属并挂 sub-agent，心跳来自租约", () => {
    const out = buildRoster({
      memberships: [
        mem({ engineer_id: "e2", role: "maintainer" }),
        mem({ engineer_id: "e1", role: "owner" }),
        mem({ engineer_id: "e3", role: "contributor", status: "pending" }),
      ],
      engineers, registry, leases: [lease("coord-main", 3)], now: NOW,
    });
    expect(out.map((m) => m.handle)).toEqual(["usam", "lichen"]);
    expect(out[0]!.name).toBe("Usam Shen");
    expect(out[1]!.name).toBe("lichen"); // display_name 空 → 回退 handle
    const coord = out[0]!.agents[0]!;
    expect(coord.id).toBe("coord-main");
    expect(coord.resource).toBe("F-coord-main");
    expect(coord.heartbeatMin).toBeCloseTo(3);
    expect(coord.subs.map((s) => s.id)).toEqual(["coord-main.reviewer"]);
    expect(coord.subs[0]!.heartbeatMin).toBeNull();
    expect(out[0]!.agents).toHaveLength(1); // 退役 agent 不出现
    expect(rosterCounts(out)).toEqual({ humans: 2, agents: 3 });
  });

  it("github_login 为空的 engineer 不认领任何 agent（不按 handle 匹配）", () => {
    const out = buildRoster({ memberships: [mem({ engineer_id: "e3", role: "contributor" })], engineers, registry, leases: [], now: NOW });
    expect(out[0]!.agents).toEqual([]);
  });

  it("未知角色退化为 contributor", () => {
    const out = buildRoster({ memberships: [mem({ engineer_id: "e2", role: "weird" })], engineers, registry: [], leases: [], now: NOW });
    expect(out[0]!.role).toBe("contributor");
  });
});
