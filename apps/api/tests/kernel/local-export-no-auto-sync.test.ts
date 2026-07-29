/**
 * F17 V11① —— 「**显式一次性人工动作**，禁止任何自动同步 / 后台上传 / 定时推送」。
 *
 * ## 这个文件要区分的两件事，在成功路径上**完全一样**
 *
 *   (甲) 导出期间，出网守卫被整个关掉
 *   (乙) 导出期间，守卫只为**被选中的那几件**打开
 *
 * 两者都让导出成功，都让 F16 的其余断言保持绿色，且代码量差不多。区别只出现在
 * 没人会顺手走一遍的路径上：一件**没被选中**的东西、一次**发生在传输之外**的连接、
 * 一次**导出结束之后**的调用。所以本文件的每一条断言都长在那三条路径上。
 *
 * F16 的注释里已经写过同型的教训：出网守卫的第一版能认出 `new Socket().connect(port, host)`
 * 却认不出 `net.connect({...})`，于是 `http` / `https` / `undici` / `fetch` 全部畅通，
 * 而它自己的测试全绿。那个洞是被**反证**（故意加一条出网路径，看门控红不红）抓到的，
 * 不是被评审抓到的。这里沿用同一条纪律。
 *
 * ## 断言 / 反证 对照
 *
 *   开得窄  aperture 内出网被放行            ← 没有它，「窄」可以由「全关」来满足
 *           aperture **外**（同一次导出内）出网被拒 ← 甲乙之分就在这一条
 *           未被选中的成果**开不出** aperture
 *   关得上  导出返回后，守卫恢复原状
 *           被留存下来的 aperture 不能再用（这就是「后台定时推送」的形状）
 *           脱离作用域的异步链也不能用
 */
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ExportApertureClosedError,
  ExportItemNotApprovedError,
  LocalOrgEgressBlockedError,
} from "../../src/application/identity/errors";
import type { ExportAperture } from "../../src/application/identity/local-org-ports";
import { ProcessEgressGuard } from "../../src/infrastructure/egress/local-egress-guard";
import { exportToOrganization } from "../../src/application/identity/export-to-organization";
import type { OrgId } from "../../src/domain/org-id";
import { fakeExportDeps, LOCAL_ORG, REAL_ORG, SELECTED, UNSELECTED } from "../support/export-fakes";

/** TEST-NET-3：保留给文档用，定义上就在本机之外。 */
const OFF_MACHINE_HOST = "203.0.113.9";
const OFF_MACHINE_PORT = 9;

const ORG = LOCAL_ORG as OrgId;

let guard: ProcessEgressGuard;
let loopbackServer: net.Server;
let loopbackPort = 0;

beforeAll(async () => {
  guard = new ProcessEgressGuard();
  loopbackServer = net.createServer((s) => {
    s.on("error", () => undefined);
    s.end();
  });
  await new Promise<void>((r) => loopbackServer.listen(0, "127.0.0.1", r));
  loopbackPort = (loopbackServer.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => loopbackServer.close(() => r()));
});

/**
 * 用 `net.connect(...)` 而不是 `new Socket().connect(port, host)`。
 * 两者到达 `Socket.prototype.connect` 时**参数形状不同**，而守卫的第一版只认得后者——
 * F16 的反证正是这样抓到那个洞的。这里继承那个写法，不是风格选择。
 */
function connectOut(timeoutMs = 1500): Promise<"connected"> {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: OFF_MACHINE_HOST, port: OFF_MACHINE_PORT });
    s.setTimeout(timeoutMs, () => s.destroy(new Error("network timeout")));
    s.on("connect", () => {
      s.destroy();
      resolve("connected");
    });
    s.on("error", reject);
  });
}

function connectLoopback(): Promise<"connected"> {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: "127.0.0.1", port: loopbackPort });
    s.on("connect", () => {
      s.destroy();
      resolve("connected");
    });
    s.on("error", reject);
  });
}

/* ═══════════════════════ 开得窄：aperture 不是「守卫关掉」 ═══════════════════════ */

describe("导出期间，豁口只为被选中的成果打开", () => {
  it("aperture 内的出网被放行，并且记进 permits —— 否则「窄」由「全关」也能满足", async () => {
    const before = guard.permits().length;
    await guard.runExport(ORG, [SELECTED], async (aperture) => {
      // 连不通是意料之中的（TEST-NET-3 哪儿也去不了）；要断言的是**守卫没有拒绝它**，
      // 即失败来自网络而不是来自 LocalOrgEgressBlockedError。
      await expect(aperture.send(SELECTED, () => connectOut())).rejects.not.toBeInstanceOf(
        LocalOrgEgressBlockedError,
      );
    });
    const permits = guard.permits();
    expect(permits.length, "aperture 从没真的打开过——上面每一条断言都会被一个空转的实现满足")
      .toBe(before + 1);
    expect(permits.at(-1)).toMatchObject({ orgId: ORG, artifactId: SELECTED });
  });

  it("**甲乙之分**：同一次导出里，发生在传输之外的出网仍被拒", async () => {
    // 这一条是本文件的中心。「导出期间守卫整个关掉」会让它绿，
    // 「守卫只为选中项打开」会让它红——所以它必须红过一次才算数（见文件末的反证记录）。
    const before = guard.attemptedEgress();
    await guard.runExport(ORG, [SELECTED], async () => {
      // 没有 send()。这是导出请求里任何一段**顺带**发生的网络活动：
      // 依赖的遥测、一次重试助手、一个无关的 await。
      await expect(connectOut()).rejects.toBeInstanceOf(LocalOrgEgressBlockedError);
    });
    expect(guard.attemptedEgress()).toBe(before + 1);
  });

  it("未被选中的成果**开不出** aperture，且在任何字节移动之前就失败", async () => {
    const permitsBefore = guard.permits().length;
    await guard.runExport(ORG, [SELECTED], async (aperture) => {
      await expect(
        aperture.send(UNSELECTED, () => connectOut()),
      ).rejects.toBeInstanceOf(ExportItemNotApprovedError);
    });
    // 一条 permit 都不该多出来：拒绝发生在传输开始之前，而不是「传了但被记为拒绝」。
    expect(guard.permits().length).toBe(permitsBefore);
  });

  it("回环仍然通——豁口是隔离，不是瘫痪", async () => {
    // 没有这一条，一个「什么都拒绝」的实现能满足上面全部三条。
    // 导出本身要读数据库，而数据库就在回环上。
    const r = await guard.runExport(ORG, [SELECTED], () => connectLoopback());
    expect(r).toBe("connected");
  });

  it("并发：一次导出的 aperture 不会顺带放宽另一条本地链路", async () => {
    // AsyncLocalStorage 而不是全局标志位的全部理由。全局标志位会被一个请求打开、
    // 被另一个请求在飞行中关闭，于是承诺成立与否取决于并发——那是没人能复现的失效。
    const [exported, other] = await Promise.allSettled([
      guard.runExport(ORG, [SELECTED], (aperture) =>
        aperture.send(SELECTED, () => connectLoopback()),
      ),
      guard.runLocalOnly(ORG, () => connectOut()),
    ]);
    expect(exported.status).toBe("fulfilled");
    expect(other.status).toBe("rejected");
    expect((other as PromiseRejectedResult).reason).toBeInstanceOf(LocalOrgEgressBlockedError);
  });
});

/* ═══════════════════════ 关得上：豁口结束后守卫恢复 ═══════════════════════ */

describe("导出结束后，豁口关上", () => {
  it("导出返回之后再出网，仍被拒", async () => {
    await guard.runExport(ORG, [SELECTED], (aperture) =>
      aperture.send(SELECTED, () => connectLoopback()),
    );
    const before = guard.attemptedEgress();
    await expect(
      guard.runLocalOnly(ORG, () => connectOut()),
    ).rejects.toBeInstanceOf(LocalOrgEgressBlockedError);
    expect(guard.attemptedEgress()).toBe(before + 1);
  });

  it("**被留存下来的 aperture 不能再用**——这正是「每晚同步一次」的形状", async () => {
    // 攒一个句柄：在一次真实的、人发起的导出里拿到 aperture，留着，之后从定时器里用。
    // 它看起来无辜（「重试上次失败的导出」），而它就是 V11① 禁止的那件事。
    let stolen: ExportAperture | null = null;
    await guard.runExport(ORG, [SELECTED], async (aperture) => {
      stolen = aperture;
    });
    expect(stolen).not.toBeNull();

    await expect(
      (stolen as unknown as ExportAperture).send(SELECTED, () => connectOut()),
    ).rejects.toBeInstanceOf(ExportApertureClosedError);
  });

  it("...而且句柄失效**不是**靠「作用域外没有守卫」蒙混过去的", async () => {
    // ⚠ 这一条是上一条的必要补充：作用域之外守卫本来就不拦任何东西，
    //   所以一个「只靠 AsyncLocalStorage」的实现里，被留存的句柄不是「关上了」，
    //   而是**落进了一个根本没有守卫的地方**——比开着还糟。
    //   因此 aperture 自己带 live 标志，抛的是 ExportApertureClosedError（上一条已断言），
    //   而不是让那次连接悄悄成功。
    let stolen: ExportAperture | null = null;
    let reachedFn = false;
    await guard.runExport(ORG, [SELECTED], async (aperture) => {
      stolen = aperture;
    });
    await expect(
      (stolen as unknown as ExportAperture).send(SELECTED, async () => {
        reachedFn = true;
        return "should not run";
      }),
    ).rejects.toBeInstanceOf(ExportApertureClosedError);
    expect(reachedFn, "回调被执行了——句柄只是「没记账」，并没有真的关上").toBe(false);
  });

  it("一次导出的 aperture 用不到另一次导出的链路上", async () => {
    // ⚠ 这一条守的是 `send` 里的**作用域检查**，而不是 live 标志——两次导出并发时
    //   A 的 aperture 是 live 的（A 还没结束），能挡住它的只有「当前这条异步链属于哪次导出」。
    //   没有它，一次合法导出可以在另一次合法导出的链路里搭车，
    //   而两边各自的选中集合都是「被确认过的」，日志上看不出任何异常。
    let apertureOfA: ExportAperture | null = null;
    await guard.runExport(ORG, [SELECTED], async (a) => {
      apertureOfA = a;
      await guard.runExport(ORG, [UNSELECTED], async () => {
        // 现在这条链属于 B。用 A 的句柄，即便 A 仍然 live。
        await expect(
          (apertureOfA as unknown as ExportAperture).send(SELECTED, () => connectOut()),
        ).rejects.toBeInstanceOf(ExportApertureClosedError);
      });
    });
  });

  it("脱离作用域的异步链也用不了它", async () => {
    // 导出内部启动、导出结束后才 resolve 的游离 promise。
    //
    // ⚠ **这一条是 live 标志唯一挡得住的东西，而且它是必需的**：反证时把 live 去掉，
    //   只有这一条变红。原因是 `AsyncLocalStorage` **会穿过 setTimeout**——
    //   于是「导出里起一个定时器，导出结束后它继续用 aperture」这条链上
    //   作用域检查仍然通过。那正是「每晚同步一次」的实现形状。
    let detached: Promise<unknown> | null = null;
    await guard.runExport(ORG, [SELECTED], async (aperture) => {
      detached = (async () => {
        await new Promise((r) => setTimeout(r, 5));
        return aperture.send(SELECTED, () => connectOut());
      })();
    });
    await expect(detached as unknown as Promise<unknown>).rejects.toBeInstanceOf(
      ExportApertureClosedError,
    );
  });
});

/* ═══════════════════════ 用例这一层：搬运真的在 aperture 里 ═══════════════════════ */

describe("导出用例把字节搬运放在豁口内，而不是放在它旁边", () => {
  it("一次真实导出里，出网的 artifactId 恰好是被确认的那一组", async () => {
    // 传输实现故意出网（跨部署时它本来就会出网），于是「搬运在不在豁口里」变成一个
    // 可观测的事实：在，就进 permits；不在，就被拒。
    const deps = fakeExportDeps({ guard, transport: () => connectOut().catch(() => undefined) });
    const before = guard.permits().length;

    const out = await exportToOrganization(deps.deps, {
      userId: "u-f17-owner",
      fromLocalOrgId: LOCAL_ORG as OrgId,
      toOrgId: REAL_ORG as OrgId,
      artifactIds: [SELECTED],
      confirmedPreviewToken: deps.token,
    });

    expect(out.copiedArtifactIds).toEqual([SELECTED]);
    const added = guard.permits().slice(before);
    expect(added.length, "搬运没有经过 aperture —— 那样的话跨部署实现将不受任何约束")
      .toBeGreaterThan(0);
    // 断言的是**性质**：放行过的每一条，其 artifactId 都在被确认的集合里。
    for (const p of added) {
      expect(p.artifactId).toBe(SELECTED);
      expect(p.orgId).toBe(LOCAL_ORG);
    }
  });

  it("反证：没有令牌就没有导出，因此也不存在「后台悄悄推一次」这条路径", async () => {
    const deps = fakeExportDeps({ guard, transport: () => connectOut().catch(() => undefined) });
    const before = guard.permits().length;
    await expect(
      exportToOrganization(deps.deps, {
        userId: "u-f17-owner",
        fromLocalOrgId: LOCAL_ORG as OrgId,
        toOrgId: REAL_ORG as OrgId,
        artifactIds: [SELECTED],
        confirmedPreviewToken: "xprv-not-a-real-token",
      }),
    ).rejects.toMatchObject({ code: "EXPORT_PREVIEW_REQUIRED" });
    // 关键在这一行：失败发生在**任何字节移动之前**。
    // 一个「先传后校验」的实现会让上面那条断言照样绿，而数据已经出去了。
    expect(guard.permits().length).toBe(before);
  });
});
