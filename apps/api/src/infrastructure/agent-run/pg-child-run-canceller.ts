import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { ChildRunCanceller, ParentCancellation } from "../../application/agent-run/parent-run-control";
import { PgSubtaskRunStore } from "./pg-subtask-run-store";
/** Reuses the derived queue's tenant transactions; owns no parent lifecycle state. */
export class PgChildRunCanceller implements ChildRunCanceller {
  private readonly store: PgSubtaskRunStore;
  /**
   * `kick` 是可选的（无执行器的进程照旧只写库）。它不是优化：父 run 取消只在库里给子任务
   * 打上取消请求，**真正去停远端并对账终态的是执行器的 `tick`**（`recoverCancellation`）。
   * 不 kick 的话，这一跳要等下一次环境里恰好发生的 tick——实测 run 34409361606 里等了
   * 119 秒（22:07:16 落 failed+unknown → 22:09:15 才确认），和 F5 判据 2 的 120 秒预算
   * 只差 1 秒，绿与红取决于赛跑而不是行为。
   */
  constructor(db: DatabasePort, private readonly executor?: { kick(orgId: OrgId): void }) {
    this.store = new PgSubtaskRunStore(db);
  }
  async cancelChildren(input: ParentCancellation) {
    const result = await this.store.cancelChildren(input);
    this.executor?.kick(input.orgId);
    return result;
  }
  readCancellation(input: ParentCancellation) { return this.store.readCancellation(input); }
}
