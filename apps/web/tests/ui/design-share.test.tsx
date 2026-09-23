/**
 * 迭代 22 —— 发布与分享的界面断言。
 *
 * 这一套要钉住的是三句会被说出口的话，每一句都必须对应一件真的发生的事：
 *   ① 「任何拿到链接的人都能打开」——所以档位选择必须在发布之前就摆出来；
 *   ② 「对方看到的是发布那一刻的快照」——所以画布改过之后屏上要**主动**说它旧了；
 *   ③ 「取消发布是真的收回」——所以那句话要在屏上，不是只写在契约注释里。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShareDialog, SHARE_SCOPE_LABEL } from "@/components/design-loop/share-dialog";
import { SharedDesignView } from "@/components/design-loop/shared-design-view";
import { humanTime } from "@/lib/human-time";

/** 两处夹具共用的发布时刻——断言从它推期望值，不再手抄字面量。 */
const PUBLISHED_AT = "2026-09-22T10:00:00.000Z";
import { designShareUrl, type DesignProject, type SharedDesign } from "@/lib/live-design-workbench";
import { ApiError } from "@/lib/api-client";
import { designPrototype } from "@repo/contracts";

afterEach(() => {
  cleanup();
  // 假时钟只在个别用例里开，收尾一律还原——漏还原会让后面的用例在一个停住的
  // 时钟上跑，症状是「换个执行顺序就红」，最难查的那一类。
  vi.useRealTimers();
});

const screenTree = (label: string): designPrototype.PrototypeNode => ({
  type: "stack",
  id: `s-${label}`,
  children: [
    { type: "navbar", id: `nav-${label}`, props: { title: label } },
    { type: "button", id: `btn-${label}`, props: { label: "下一步", variant: "primary" } },
  ],
});

function project(over: Partial<DesignProject> = {}): DesignProject {
  return {
    id: "p1", name: "外卖下单", template: "mobile", theme: "dark", accent: "blue", tokens: { brand: null, font: "sans" },
    tags: [], refImages: [], share: null,
    problem: "内部立项背景", criteria: ["三步内下单"],
    frames: ["首页", "下单"], prototype: [screenTree("首页"), screenTree("下单")],
    frameNotes: ["首屏即可下单", ""],
    pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null,
    chat: [], ownerId: "u1", ownerName: "我",
    createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z",
    ...over,
  };
}

const published = (over: Partial<NonNullable<DesignProject["share"]>> = {}) => ({
  token: "bG9j.secret", scope: "prototype" as const, publishedAt: PUBLISHED_AT, stale: false, ...over,
});

const dialogProps = {
  busy: false, error: null, onClose: () => undefined, onPublish: () => undefined, onUnpublish: () => undefined,
  origin: "https://devapp.boardx.us",
};

describe("分享弹窗", () => {
  it("没发布过时说清「不需要登录」，并且在发布之前就要选带出去多少", () => {
    /*
     * ⭐ 反证锚点：把档位选择挪到发布之后 ⇒ 这条红。
     * 那意味着用户点「发布」的那一刻并不知道自己发的是原型还是连立项背景一起，
     * 而 `problem` 常常是 `importThread` 从内部对话导进来的。
     */
    render(<ShareDialog {...dialogProps} project={project()} />);
    expect(screen.getByTestId("design-share-dialog").textContent).toContain("不需要登录");
    expect(screen.getByTestId("design-share-scope-prototype")).toBeTruthy();
    expect(screen.getByTestId("design-share-scope-full")).toBeTruthy();
    // 默认落在保守那一档
    expect((screen.getByTestId("design-share-scope-prototype") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId("design-share-publish").textContent).toContain("发布并生成链接");
    // 还没发布 ⇒ 没有链接框、没有取消发布
    expect(screen.queryByTestId("design-share-url")).toBeNull();
    expect(screen.queryByTestId("design-share-unpublish")).toBeNull();
  });

  it("发布时把当前选中的档位交上去，不是恒发默认那档", () => {
    const onPublish = vi.fn();
    render(<ShareDialog {...dialogProps} project={project()} onPublish={onPublish} />);
    fireEvent.click(screen.getByTestId("design-share-scope-full"));
    fireEvent.click(screen.getByTestId("design-share-publish"));
    expect(onPublish).toHaveBeenCalledWith("full");
  });

  it("已发布 ⇒ 链接可复制，按钮变成「更新发布」，并说清取消发布会真的失效", async () => {
    const copy = vi.fn<(t: string) => Promise<void>>().mockResolvedValue(undefined);
    render(<ShareDialog {...dialogProps} project={project({ share: published() })} copy={copy} />);
    const url = screen.getByTestId("design-share-url") as HTMLInputElement;
    expect(url.value).toBe("https://devapp.boardx.us/d/bG9j.secret");
    fireEvent.click(screen.getByTestId("design-share-copy"));
    await waitFor(() => expect(copy).toHaveBeenCalledWith("https://devapp.boardx.us/d/bG9j.secret"));
    expect(screen.getByTestId("design-share-publish").textContent).toContain("更新发布");
    expect(screen.getByTestId("design-share-dialog").textContent).toContain("立刻失效");
  });

  it("快照过期 ⇒ 屏上主动说「对方看到的还是旧的」", () => {
    /*
     * ⭐ 反证锚点：把 `stale` 那段提示删掉 ⇒ 这条红。
     * 这正是本仓那条「静态痕迹 ≠ 动态事实」：屏上"已分享"写下来就不再变，
     * 画布却还在改——不说，两边都不会发现对方看到的是三轮之前。
     */
    render(<ShareDialog {...dialogProps} project={project({ share: published({ stale: true }) })} />);
    expect(screen.getByTestId("design-share-stale").textContent).toContain("还是旧的那一份");
  });

  it("一页都没画出来 ⇒ 发布按钮禁用，并说明为什么", () => {
    render(<ShareDialog {...dialogProps} project={project({ frames: ["首页"], prototype: [null] })} />);
    expect((screen.getByTestId("design-share-publish") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("design-share-nothing").textContent).toContain("白屏");
  });

  it("两档都有人话——闭集穷举，不会出现一个没有说明的选项", () => {
    for (const [scope, label] of Object.entries(SHARE_SCOPE_LABEL)) {
      expect(label.length, `档位 ${scope} 没有人话`).toBeGreaterThan(0);
    }
    expect(Object.keys(SHARE_SCOPE_LABEL).sort()).toEqual(["full", "prototype"]);
  });
});

describe("分享链接地址", () => {
  it("短路径 /d/<token>，origin 尾斜杠不会拼出两个斜杠", () => {
    expect(designShareUrl("https://a.com", "t1")).toBe("https://a.com/d/t1");
    expect(designShareUrl("https://a.com/", "t1")).toBe("https://a.com/d/t1");
  });
});

/* ───────────────────────── 分享页（访客看到的那一屏） ───────────────────────── */

function shared(over: Partial<SharedDesign> = {}): SharedDesign {
  return {
    name: "外卖下单", template: "mobile", theme: "dark", accent: "blue", tokens: { brand: null, font: "sans" },
    frames: ["首页", "下单"], prototype: [screenTree("首页"), screenTree("下单")],
    frameNotes: ["首屏即可下单", ""],
    frameLinks: [[{ from: "btn-首页", to: 1 }], []],
    publishedAt: PUBLISHED_AT, ownerName: "小王",
    problem: null, criteria: null,
    ...over,
  };
}

describe("分享页", () => {
  it("说清是谁发的、哪一版、只读——访客要知道自己看的是不是最新的", async () => {
    // 把「现在」钉在发布之后两小时：相对日期恒为「今天」，不随真实日期漂移。
    // `shouldAdvanceTime` 不是可选项：RTL 的 `findBy*` 靠定时器轮询，
    // 停住的时钟会让它等到超时（第一版就这么红了 15 秒）。这里只要钉住「现在」，
    // 不需要冻结时间流逝。
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-22T12:00:00.000Z"));
    /*
     * ⭐ 反证锚点：把发布时间从页头拿掉 ⇒ 这条红。
     * 这条链接是一份冻结的快照，设计者这会儿很可能已经改过三轮；不写发布时间，
     * 「我看到的是不是最新的」就只能靠问。
     */
    render(<SharedDesignView token="t" load={async () => ({ design: shared() })} />);
    await screen.findByTestId("shared-design-view");
    expect(screen.getByTestId("shared-design-name").textContent).toBe("外卖下单");
    const meta = screen.getByTestId("shared-design-meta").textContent ?? "";
    expect(meta).toContain("小王");
    expect(meta).toContain("只读");
    expect(meta).toContain("发布于");
    /*
     * ⚠ 这里**不能**写死 "10:00"（2026-09-23 修）。原断言有两处环境依赖，叠在一起：
     *   ① `humanTime` 渲染的是**相对**日期（今天 / 昨天 / M月D日），随"现在"漂移——
     *      夹具发布于 09-22，到了 09-23 就变成「昨天」；
     *   ② 时分按运行机器的时区算——同一个 10:00Z 在 UTC 是 10:00、在 +08 是 18:00。
     *      测试跑在哪个时区没有被钉住（vitest 没有设 TZ）。
     * 写死字面量等于把这两件环境事实抄了一份进断言，隔一天或换台机器就红。
     *
     * 改法：时刻钉死（`vi.setSystemTime`），期望值**从同一个 `humanTime` 取**——
     * 它就是页面用的那一个，不是我在测试里复刻的第二份格式化逻辑。
     * 强度没有下降：把发布时间从页头拿掉，这条仍然红（见本用例头部的反证锚点）。
     */
    expect(meta).toContain(humanTime(PUBLISHED_AT));
  });

  it("prototype 档不渲染「问题与目标」那一节；full 档才有", async () => {
    render(<SharedDesignView token="t" load={async () => ({ design: shared() })} />);
    await screen.findByTestId("shared-design-view");
    expect(screen.queryByTestId("shared-design-brief")).toBeNull();
    cleanup();

    render(<SharedDesignView token="t" load={async () => ({ design: shared({ problem: "退订找不到", criteria: ["三步内退订"] }) })} />);
    await screen.findByTestId("shared-design-brief");
    expect(screen.getByTestId("shared-design-brief").textContent).toContain("三步内退订");
  });

  it("跳转默认就能点：点有跳转的按钮换页，再按「返回」回来", async () => {
    /*
     * ⭐ 反证锚点：把 `mode` 改回 `edit` ⇒ 这条红。
     *
     * 详情页里「预览」是要主动切过去的模式；在分享页它是唯一的模式——链接发出去
     * 就是为了让人走一遍，再让他先找到一个开关才点得动，等于把这条链接最值钱的
     * 部分藏起来。
     */
    render(<SharedDesignView token="t" load={async () => ({ design: shared() })} />);
    await screen.findByTestId("shared-design-view");
    expect(screen.queryByTestId("shared-design-back")).toBeNull();

    fireEvent.click(screen.getByText("下一步"));
    await waitFor(() => expect(screen.getByTestId("shared-design-frame-1").getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(screen.getByTestId("shared-design-back"));
    await waitFor(() => expect(screen.getByTestId("shared-design-frame-0").getAttribute("aria-pressed")).toBe("true"));
  });

  it("没画出来的页在页签上如实标出来，不假装这份原型只有几页", async () => {
    render(<SharedDesignView token="t" load={async () => ({ design: shared({ prototype: [screenTree("首页"), null] }) })} />);
    await screen.findByTestId("shared-design-view");
    expect(screen.getByTestId("shared-design-frame-1").textContent).toContain("还没画");
  });

  it("链接打不开 ⇒ 一句话说清下一步，且不区分「不存在」和「已取消」", async () => {
    /*
     * ⭐ 反证锚点：按服务端的两个不同原因分别说两句话 ⇒ 这条红（而服务端根本只有一个码）。
     * 分开说等于给试令牌的人一个进度条。
     */
    render(<SharedDesignView token="t" load={async () => { throw new ApiError(404, "SHARE_NOT_FOUND", {}); }} />);
    const box = await screen.findByTestId("shared-design-error");
    expect(box.textContent).toContain("取消分享");
    expect(box.textContent).toContain("要一条新的");
  });

  it("断网/5xx 不冒充成「已被取消分享」——那会让人去找发链接的人白跑一趟", async () => {
    render(<SharedDesignView token="t" load={async () => { throw new ApiError(503, null, {}); }} />);
    const box = await screen.findByTestId("shared-design-error");
    expect(box.textContent).toContain("稍后再试");
    expect(box.textContent).not.toContain("取消分享");
  });
});

describe("迭代 29：交出去的那一步不许假装成功", () => {
  it("复制链接被浏览器拒 ⇒ 屏上说清怎么手动复制，而不是一声不吭", async () => {
    /*
     * ⭐ 反证锚点：把 catch 改回只 `setCopied(false)` ⇒ 这条红。
     * 非安全上下文（内网 http）下剪贴板 API 一律被拒，而这正是"把链接发给别人"那一步：
     * 不说话，人会以为复制到了，然后粘出去一片空白。
     */
    render(
      <ShareDialog
        {...dialogProps}
        project={project({ share: published() })}
        copy={async () => { throw new Error("NotAllowedError"); }}
      />,
    );
    fireEvent.click(screen.getByTestId("design-share-copy"));
    const note = await screen.findByTestId("design-share-copy-failed");
    expect(note.textContent).toContain("Ctrl");
    expect(screen.getByTestId("design-share-copy").textContent).not.toContain("已复制");
  });

  it("发布时间说人话，不是带秒的机器时间", () => {
    // ⭐ 反证锚点：改回 `new Date(x).toLocaleString("zh-CN")` ⇒ 这条红。
    render(<ShareDialog {...dialogProps} project={project({ share: published({ publishedAt: new Date().toISOString() }) })} />);
    expect(screen.getByTestId("design-share-published-at").textContent).toContain("刚刚");
  });

  it("访客那边打不开时给「再试一次」，重试真的会重新拉一次", async () => {
    /*
     * ⭐ 反证锚点：去掉按钮、或让它不改 reloadAt ⇒ 这条红。
     * 访客多半在手机上，断网只是过一条隧道；让他回头去找发链接的人是白跑一趟。
     */
    let calls = 0;
    const load = async () => {
      calls += 1;
      if (calls === 1) throw new ApiError(503, null, {});
      return { design: shared() };
    };
    render(<SharedDesignView token="t" load={load} />);
    await screen.findByTestId("shared-design-error");
    fireEvent.click(screen.getByTestId("shared-design-retry"));
    await screen.findByTestId("shared-design-view");
    expect(calls).toBe(2);
  });

  it("「链接已被取消分享」这一类不给重试——再点一百次也还是那条失效链接", async () => {
    render(<SharedDesignView token="t" load={async () => { throw new ApiError(404, "SHARE_NOT_FOUND", {}); }} />);
    await screen.findByTestId("shared-design-error");
    expect(screen.queryByTestId("shared-design-retry")).toBeNull();
  });

  it("访客页底部说清这是哪一刻的快照，以及想看最新的该怎么办", async () => {
    // ⭐ 反证锚点：把底部改回「这是一份只读的设计原型快照」⇒ 这条红。
    render(<SharedDesignView token="t" load={async () => ({ design: shared({ publishedAt: new Date().toISOString() }) })} />);
    const view = await screen.findByTestId("shared-design-view");
    expect(view.textContent).toContain("刚刚");
    expect(view.textContent).toContain("找发给你的人再发一条");
  });
});

/* ────── UIUX 第 20 轮：发出去这一步——收回要问，档位改了要说，颜色得真的是红的 ────── */

describe("UIUX 20：分享弹窗", () => {
  it("「取消发布」先问一句：不确认就不收回", () => {
    const onUnpublish = vi.fn();
    render(<ShareDialog {...dialogProps} onUnpublish={onUnpublish} project={project({ share: published() })} />);
    fireEvent.click(screen.getByTestId("design-share-unpublish"));

    // ⭐ 反证锚点：把按钮接回裸 onUnpublish ⇒ 这三条红——链接可能已经发给客户了，
    //   收回之后对方再点开就是一句「打不开」，而且不会收到任何通知。
    expect(onUnpublish).not.toHaveBeenCalled();
    const box = screen.getByTestId("design-share-unpublish-confirm");
    expect(box.textContent).toContain("不会收到任何通知");

    fireEvent.click(screen.getByTestId("design-share-unpublish-cancel"));
    expect(screen.queryByTestId("design-share-unpublish-confirm")).toBeNull();
    expect(onUnpublish).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("design-share-unpublish"));
    fireEvent.click(screen.getByTestId("design-share-unpublish-yes"));
    expect(onUnpublish).toHaveBeenCalledTimes(1);
  });

  it("已发布之后改了档位 ⇒ 说清要按「更新发布」才对已发出去的链接生效", () => {
    render(<ShareDialog {...dialogProps} project={project({ share: published({ scope: "prototype" }) })} />);
    expect(screen.queryByTestId("design-share-scope-pending")).toBeNull();
    fireEvent.click(screen.getByTestId("design-share-scope-full"));
    // ⭐ 反证锚点：去掉那句提示 ⇒ 这条红（用户切了下拉就关窗，以为对方已经看得到）。
    expect(screen.getByTestId("design-share-scope-pending").textContent).toContain("更新发布");
  });

  it("失败那句话是红的——`text-danger` 在本仓不存在，写了等于没写", () => {
    render(<ShareDialog {...dialogProps} error="没能发布（服务器出错了）" project={project()} />);
    const p = screen.getByTestId("design-share-error");
    // ⭐ 反证锚点：改回 `text-danger` ⇒ 这条红。Tailwind 对不认识的类名不报错、
    //   只是不生成任何 CSS，于是「发布失败」以正文颜色渲染，和旁边的说明一模一样。
    expect(p.className).toContain("text-destructive");
    expect(p.className).not.toContain("text-danger");
    expect(p.getAttribute("role")).toBe("alert");
  });

  it("Esc 关得掉（这一屏此前连焦点管理都没有）", () => {
    const onClose = vi.fn();
    render(<ShareDialog {...dialogProps} onClose={onClose} project={project()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    // ⭐ 反证锚点：去掉 useDialogFocus ⇒ 这条红。
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("打开就把焦点放进弹窗里，不是留在背后的页面上", () => {
    render(<ShareDialog {...dialogProps} project={project()} />);
    const dialog = screen.getByRole("dialog");
    // ⭐ 反证锚点：去掉 useDialogFocus ⇒ 这条红（焦点还在打开它的那个按钮上，
    //   读屏用户不知道弹窗开了，Tab 走的还是背后那一屏）。
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
