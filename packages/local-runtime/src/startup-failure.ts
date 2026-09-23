/**
 * 启动失败不是终点——把它分诊成「能按一下按钮就解决」的东西（#3872 R10）。
 *
 * ## 为什么必须有这一层
 *
 * 2026-09-23 读这台机器上真实安装版自己的 `desktop.log`（累计 25,000 行），
 * **14 次启动失败**，没有一次是用户能靠界面解决的：
 *
 * | 次数 | 原来给用户看的（原文，英文内部消息）                                        | 原来的出路                    |
 * | ---- | --------------------------------------------------------------------------- | ----------------------------- |
 * | 6    | `PGlite could not open …: it was left inconsistent by a hard kill`           | 「把目录挪走，它会由迁移+种子重建」→ **等于叫用户丢掉自己的全部数据** |
 * | 5    | `127.0.0.1:55432 (PostgreSQL) is already in use`                            | 「`lsof -ti :55432 \| xargs kill`」→ **叫终端用户去敲 shell** |
 * | 3    | `127.0.0.1:3310 (skill-sandbox) is already in use`                          | 同上                          |
 *
 * 这两句出路对开发者是对的，对一个独立发布的桌面应用是不能出现的。而且第一句现在
 * 已经**过时且有害**：R1/R5 之后应用自己有备份与恢复，所以「重建」不该再是唯一选项。
 *
 * 占着端口的那个进程一定是**我们自己**上一次没退干净的实例（全是 127.0.0.1 上我们
 * 独占的端口），所以「替用户收回端口」是安全的，和 Ollama 备用端口那条路径同一个理由。
 *
 * ## 这一层只做分诊
 *
 * 判据写在这里，按钮和弹框在桌面壳里。分诊不去碰磁盘、不杀进程——这样它可以被
 * 纯函数测试钉住，而反证只要改一句文案就会红。
 */

/** 用户按下去之后桌面壳该做的事。 */
export type StartupRemedy =
  | { readonly kind: "reclaim-port"; readonly port: number; readonly label: string }
  | { readonly kind: "restore-backup"; readonly label: string }
  | { readonly kind: "move-aside"; readonly label: string };

export interface StartupDiagnosis {
  /** 说人话的标题：说清「发生了什么」，不含内部服务名和退出码。 */
  readonly title: string;
  /** 两到三句：为什么会这样、按哪个按钮、会不会丢东西。 */
  readonly body: string;
  /** 第一个是推荐项；空数组表示我们也不知道，只能把原文给出去。 */
  readonly remedies: readonly StartupRemedy[];
  /** 分诊不认识这条错误——桌面壳退回「显示原文 + 日志」。 */
  readonly unknown: boolean;
}

/** 端口对用户没有意义，占用它的那个服务叫什么才有。 */
const PORT_OWNERS: Record<number, string> = {
  55432: "数据库", 3200: "后端", 3100: "界面", 3310: "技能沙箱", 3320: "语音转写", 11435: "本地模型",
};

export function diagnoseStartupFailure(
  message: string,
  ctx: { readonly hasBackup: boolean },
): StartupDiagnosis {
  const port = /127\.0\.0\.1:(\d+)\D+is already in use/.exec(message);
  if (port !== null) {
    const p = Number(port[1]);
    const who = PORT_OWNERS[p] ?? "其中一个组件";
    return {
      title: "上一次没有完全退出",
      body:
        `${who}用的端口还被上一次运行的 WorkspaceX 占着，所以这一次起不来。\n`
        + "这不影响你的数据。点「收回并重试」，应用会让那个残留的进程退出，然后重新启动。",
      remedies: [{ kind: "reclaim-port", port: p, label: "收回并重试" }],
      unknown: false,
    };
  }

  if (/could not open/.test(message) && /hard kill|inconsistent/.test(message)) {
    // ⚠ 这里**不许**再出现「由迁移和种子重建」当作唯一出路：那是把用户的数据当成
    //   可再生的测试数据。有备份就先推荐恢复；没有备份也要说清挪走的那份没有被删。
    const remedies: StartupRemedy[] = [];
    if (ctx.hasBackup) remedies.push({ kind: "restore-backup", label: "从最近一次备份恢复" });
    remedies.push({ kind: "move-aside", label: "先空着启动（旧数据留着）" });
    return {
      title: "上一次是被强制结束的，数据库没能收尾",
      body:
        "数据库上次没有正常关闭，现在打不开。\n"
        + (ctx.hasBackup
          ? "你有备份：点「从最近一次备份恢复」，恢复完会核对行数再告诉你。"
          : "没有找到备份。可以先空着启动把应用用起来。")
        + "\n无论选哪个，现在这份数据都只是被挪到同目录下带时间戳的文件夹里，不会被删除。",
      remedies,
      unknown: false,
    };
  }

  return {
    title: "启动失败",
    body: "应用没能起来。下面是原始信息，日志里有完整过程。",
    remedies: [],
    unknown: true,
  };
}
