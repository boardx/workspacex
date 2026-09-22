// 应用层（F06）：把引擎产出的调用描述真正发到 GitHub REST。
// 单条失败会被计数并继续尝试整批其余调用；上层看到 failed>0 时不推进游标，
// 下一 tick 重放该事件批，避免事件驱动动作永久漏投。
//
// 重放的代价分两类（#376）：
//   - 覆盖式动作（commit_status / check_run）：同 sha + 同 context/name 重发是覆盖，
//     重放无害，而且正是 andon/lease 每 tick 对账所依赖的机制——绝不能去重。
//   - 追加式动作（issue_comment）：重发 = issue 上多一条评论。批次"部分成功后整批重放"
//     的模型下，已经成功的那几条评论每次重试都会再刷一遍。
// 因此追加式动作带 idempotency_key（engine.ts 推导），投递成功后登记进**持久发件箱**
// （ProjectionOutbox，生产实现落在 RepoHub DO 的 projection_outbox 表），重放时先查后发。
// 剩余窗口（已诚实记账，不假装 exactly-once）：POST 已经到达 GitHub、record() 却没落库
// 就宕机——下 tick 仍会重发一次。这一段保留 at-least-once，与仓内既有取舍一致
// （漏投比可见的重复更危险）；发件箱把"每次重试都重复"收窄成"仅崩在这条缝里才重复"。
import type { GithubCall } from "./engine";

/**
 * 持久发件箱端口（#376）。生产实现由宿主注入（coord-gateway → RepoHub DO），
 * 测试可注入内存实现。语义要求：record() 必须在返回前**持久化**，否则去重不成立。
 */
export interface ProjectionOutbox {
  /** 返回 keys 中已确认投递过的子集；顺序不限，宿主按集合语义使用。 */
  delivered(keys: string[]): Promise<string[]>;
  /** 登记一条已成功投递的逻辑动作。必须幂等（重复登记同一 key 不报错）。 */
  record(key: string): Promise<void>;
}

export interface ApplyOptions {
  owner: string;
  repo: string;
  token: string; // installation token（github-app.ts 产出）
  calls: GithubCall[];
  fetchImpl?: typeof fetch;
  apiBase?: string;
  /** 缺省不去重（保持老调用方行为）；生产路径必须注入，否则重放会刷重复评论。 */
  outbox?: ProjectionOutbox;
}

export interface ApplyResult {
  applied: number;
  failed: number;
  /** 发件箱判定为"本轮之前已投递"而跳过的条数（#376）。不算失败，不阻游标推进。 */
  skipped: number;
}

/** 调用描述上的幂等键；覆盖式动作没有键（刻意每 tick 重发做对账）。 */
function idempotencyKeyOf(call: GithubCall): string | null {
  return call.kind === "issue_comment" ? call.idempotency_key : null;
}

export async function applyCalls(opts: ApplyOptions): Promise<ApplyResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const apiBase = opts.apiBase ?? "https://api.github.com";
  const repoBase = `${apiBase}/repos/${opts.owner}/${opts.repo}`;
  let applied = 0;
  let failed = 0;
  let skipped = 0;

  // 整批一次查发件箱（而不是逐条往返）；查不到就按"未投递"走——发件箱读失败
  // 只会退化成今天的重复风险，不会让动作漏投。
  let delivered = new Set<string>();
  const keys = opts.calls.map(idempotencyKeyOf).filter((k): k is string => k !== null);
  if (opts.outbox && keys.length > 0) {
    try {
      delivered = new Set(await opts.outbox.delivered(keys));
    } catch (e) {
      console.error("[coord-projection] 发件箱查询失败（本批退化为不去重，可能重复投递）", e);
    }
  }

  for (const call of opts.calls) {
    const key = idempotencyKeyOf(call);
    if (key !== null && delivered.has(key)) {
      skipped++;
      continue;
    }

    let url: string;
    let body: Record<string, unknown>;
    if (call.kind === "commit_status") {
      url = `${repoBase}/statuses/${call.sha}`;
      body = { state: call.state, context: call.context, description: call.description };
    } else if (call.kind === "check_run") {
      url = `${repoBase}/check-runs`;
      body = {
        name: call.name,
        head_sha: call.head_sha,
        status: "completed",
        conclusion: call.conclusion,
        output: { title: call.title, summary: call.summary },
      };
    } else {
      // issue_comment（p30/F09 意图消息双写）
      url = `${repoBase}/issues/${call.issue_number}/comments`;
      body = { body: call.body };
    }
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.token}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
          "user-agent": "coord-projection",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`github_api_${res.status}`);
      applied++;
      // 逐条登记，不攒到批末：批次中途失败会提前结束本 tick，攒批会把已经发出去的
      // 评论丢在账外，下 tick 照样重复——这正是 #376 要修的那个洞。
      if (key !== null && opts.outbox) {
        try {
          await opts.outbox.record(key);
          delivered.add(key);
        } catch (e) {
          // 评论已经发出去了，不能因为记账失败就把它算作失败（那会卡住游标并招致重复）。
          // 只能告警：这条 key 留在"已发未记"状态，下 tick 会重复一次。
          console.error(`[coord-projection] 发件箱登记失败（下 tick 可能重复投递）: ${key}`, e);
        }
      }
    } catch (e) {
      failed++;
      console.error(`[coord-projection] apply 失败（继续整批）: POST ${url}`, e);
    }
  }
  return { applied, failed, skipped };
}
