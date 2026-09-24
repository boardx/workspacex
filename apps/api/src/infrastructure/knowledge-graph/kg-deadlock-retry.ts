/**
 * Phase 18 F16 —— 死锁（Postgres 40P01）时把整个事务重来一次。
 *
 * 知识图谱的写函数都按「会话锁 → 个人空间锁 → 行」的顺序拿锁，结束冲突的触发器从不等锁（迁移 20260924290000），
 * 按设计不该再有死锁。这里是纵深防御：万一撞上（例如别的束的写路径以另一种顺序碰到同几行），被 Postgres 选中回滚的
 * 那个事务整个重跑一次——事务已经回滚干净，重跑是安全的。再失败就交给调用方翻成给人看的话，不把 500 甩给用户。
 */
export const PG_DEADLOCK_DETECTED = "40P01";

export function isDeadlock(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === PG_DEADLOCK_DETECTED;
}

export async function retryOnceOnDeadlock<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!isDeadlock(e)) throw e;
    return run();
  }
}
