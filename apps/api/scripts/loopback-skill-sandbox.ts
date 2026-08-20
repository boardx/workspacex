/**
 * 沙箱的 loopback 替身**进程入口** —— 让门控在没有 docker 的环境里也能确定性地跑完
 * 「试跑 → 执行 → 产物」这条链（同 `loopback-model-provider.ts` 的纪律）。
 * design delta `skill-sandbox-execution`，F962 / #1583。
 *
 * ## ⚠ 它替身的是「执行」，**不是**「隔离」
 *
 * 这一点必须说死，否则它会变成一个假绿的来源：
 *
 * - 本替身**不提供任何隔离**。它按脚本内容返回预置结果，压根不执行代码。
 * - 因此 `verification.md` 的 **V2-a / V2-b 绝不能**用它跑 —— 那两条测的是
 *   真进程权限与真容器网络，只能在 `apps/skill-sandbox` 的真沙箱/真容器上跑
 *   （`tests/execute-script-isolation.test.ts`、`tests/container-network-isolation.test.ts`）。
 * - 它的用途只有一个：让**上层**（提交 → 轮询 → 回喂重试 → 产物落 ObjectStore）
 *   在不依赖真实模型与真实 docker 的前提下可确定性验证。
 *
 * ## 本文件只剩 `listen`
 *
 * #1652 把响应行为（指令标记表、真 pptx 生成、失败 stderr 形状）整段搬到
 * `loopback-skill-sandbox-behavior.ts`，因为真栈门控要在 vitest 进程里起同一套行为、
 * 拿实际端口与调用计数，而它不能 import 一支「加载即占端口」的脚本。
 * 行为的**唯一**事实源在那个文件，这里不再复述——照抄一份必然漂移。
 */
import { startLoopbackSkillSandbox } from "./loopback-skill-sandbox-behavior";

const PORT = Number(process.env.LOOPBACK_SKILL_SANDBOX_PORT ?? "8791");

void startLoopbackSkillSandbox(PORT).then((handle) => {
  process.stdout.write(`loopback-skill-sandbox listening on 127.0.0.1:${String(handle.port)}\n`);
});
