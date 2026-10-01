/**
 * 内部端口被别的程序占了就换一个，不让整个应用起不来（#3872 R23）。
 *
 * 实测 2026-09-27：本机一个 Docker 容器发布了 55432，安装版于是停在「以下端口已被占用：
 * 55432 PostgreSQL (PGlite)」——用户看到一个他从没听说过的端口号，能做的只有退出。
 * 而 PGlite、技能沙箱、语音、智能体这四个端口**只在我们自己的子进程之间用**：
 * 它们从 `c.ports` 派生进子进程的环境变量，挪一个号谁都不会发现。
 *
 * 不挪的：api / web 的地址在构建 web 时写死进了产物（web-build-env），挪了界面就连不上；
 * ollama 另有「复用用户自己的 Ollama」的规则。显式传了 `--ports` 的也不挪——那是人的
 * 决定，冲突要如实报出来，而不是被悄悄改掉。
 *
 * ⚠ 备选号段在 20000–31999：macOS 的临时端口从 49152 起、Linux 从 32768 起，
 *   落在那里的端口探测时是空的，下一秒就可能被某个出向连接拿去当源端口
 *   （本仓实测过一次「红但零用例」就是这个）。55432 本身就在那个区间里。
 */
import { DEFAULT_PORTS, type LocalPorts } from "./config";

export const RELOCATABLE = ["postgres", "sandbox", "asr", "deepAgent"] as const;
type Relocatable = (typeof RELOCATABLE)[number];

export interface PortMove { readonly name: Relocatable; readonly from: number; readonly to: number }

const FALLBACK_LOW = 20_000;
const FALLBACK_HIGH = 31_999;
const TRIES = 60;

/** 同一个默认端口每次落到同一个备选起点——日志好读，两次启动之间也稳定。 */
function fallbackStart(port: number): number {
  return FALLBACK_LOW + (port % (FALLBACK_HIGH - FALLBACK_LOW - TRIES));
}

export async function relocateInternalPorts(
  ports: LocalPorts,
  inUse: (port: number) => Promise<boolean>,
): Promise<{ ports: LocalPorts; moved: PortMove[] }> {
  const next: Record<string, number> = { ...ports };
  const moved: PortMove[] = [];
  const taken = new Set(Object.values(ports));
  for (const name of RELOCATABLE) {
    const port = ports[name];
    if (port !== DEFAULT_PORTS[name]) continue;       // 人显式指定的，不替他改
    if (!(await inUse(port))) continue;
    const start = fallbackStart(port);
    let to: number | null = null;
    for (let p = start; p < start + TRIES; p += 1) {
      if (taken.has(p)) continue;
      if (!(await inUse(p))) { to = p; break; }
    }
    if (to === null) continue;                          // 找不到就维持原样，交给后面的端口检查如实报
    taken.add(to);
    next[name] = to;
    moved.push({ name, from: port, to });
  }
  return { ports: next as unknown as LocalPorts, moved };
}
