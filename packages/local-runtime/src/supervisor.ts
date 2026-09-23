/**
 * 有人盯着的子进程——挂了会被按策略拉起，拉不起来会**说出来**。
 *
 * 在这之前，`startManaged` 起的每个本地服务挂掉之后既不会被拉起、也不会告诉任何人，
 * 只往日志里写一行；用户看到的是界面永远停在「正在思考」。
 * 策略本身在 `supervisor-policy.ts`（纯函数、可取证），这里只负责把它接到真实进程上。
 */

import { decideRestart, describeServiceFailure, DEFAULT_RESTART_WINDOW, SERVICE_IMPACT,
  type ExitRecord, type RestartWindow } from "./supervisor-policy";
import { startManaged, type Managed, type SpawnSpec } from "./processes";

export interface ServiceHealth {
  readonly name: string;
  /** `running` = 活着；`restarting` = 挂了正在拉起；`failed` = 拉不起来，已停手。 */
  readonly state: "running" | "restarting" | "failed";
  /** 说给用户听的那两句，`failed`/`restarting` 时非空。 */
  readonly message: { readonly title: string; readonly body: string } | null;
  readonly exits: number;
}

export interface SupervisedOptions {
  readonly spec: SpawnSpec;
  readonly log: (line: string) => void;
  /** 健康状态变化时回调——外壳据此决定要不要弹窗/改状态条。 */
  readonly onHealth?: (h: ServiceHealth) => void;
  readonly window?: RestartWindow;
  /** 只为测试注入；默认 `setTimeout`。 */
  readonly schedule?: (fn: () => void, ms: number) => void;
  readonly now?: () => number;
  /**
   * 已经起好的那个子进程。启动阶段的就绪等待仍然走 `startManaged` 原路，
   * 全部就绪之后再把监督接上去——这样「启动」和「看护」互不影响，
   * 启动失败的诊断路径一字未改。
   */
  readonly initial?: Managed;
}

export interface Supervised {
  readonly name: string;
  health(): ServiceHealth;
  /** 当前那个子进程（会随重启换掉）。 */
  current(): Managed;
  stop(): Promise<void>;
}

export function superviseManaged(o: SupervisedOptions): Supervised {
  const now = o.now ?? (() => Date.now());
  const schedule = o.schedule ?? ((fn, ms) => { setTimeout(fn, ms).unref?.(); });
  const win = o.window ?? DEFAULT_RESTART_WINDOW;
  const impact = SERVICE_IMPACT[o.spec.name] ?? "";
  const exits: ExitRecord[] = [];
  let stopping = false;
  let health: ServiceHealth = { name: o.spec.name, state: "running", message: null, exits: 0 };
  const setHealth = (h: ServiceHealth): void => { health = h; o.onHealth?.(h); };

  let managed = o.initial ?? startManaged(o.spec, o.log);
  const watch = (m: Managed): void => {
    void m.exited.then((code) => {
      if (stopping) return;
      exits.push({ at: now(), code });
      const d = decideRestart(exits, now(), win);
      const msg = describeServiceFailure(o.spec.name, d, impact);
      // 崩溃现场：只说「exit 1」是不可行动的，把它最后几行一起写进日志。
      o.log(`[${o.spec.name}] 意外退出（code=${code ?? "signal"}）。最后输出：\n${m.recentOutput()}`);
      if (d.action === "give-up") {
        setHealth({ name: o.spec.name, state: "failed", message: { title: msg.title, body: msg.body }, exits: exits.length });
        return;
      }
      setHealth({ name: o.spec.name, state: "restarting", message: { title: msg.title, body: msg.body }, exits: exits.length });
      schedule(() => {
        if (stopping) return;
        managed = startManaged(o.spec, o.log);
        setHealth({ name: o.spec.name, state: "running", message: null, exits: exits.length });
        watch(managed);
      }, d.delayMs);
    });
  };
  watch(managed);

  return {
    name: o.spec.name,
    health: () => health,
    current: () => managed,
    async stop() {
      stopping = true;
      await managed.stop();
    },
  };
}
