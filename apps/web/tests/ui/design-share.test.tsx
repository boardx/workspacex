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
import { designShareUrl, type DesignProject, type SharedDesign } from "@/lib/live-design-workbench";
import { ApiError } from "@/lib/api-client";
import { designPrototype } from "@repo/contracts";

afterEach(cleanup);

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
    id: "p1", name: "外卖下单", template: "mobile", theme: "dark", accent: "blue",
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
  token: "bG9j.secret", scope: "prototype" as const, publishedAt: "2026-09-22T10:00:00.000Z", stale: false, ...over,
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
    name: "外卖下单", template: "mobile", theme: "dark", accent: "blue",
    frames: ["首页", "下单"], prototype: [screenTree("首页"), screenTree("下单")],
    frameNotes: ["首屏即可下单", ""],
    frameLinks: [[{ from: "btn-首页", to: 1 }], []],
    publishedAt: "2026-09-22T10:00:00.000Z", ownerName: "小王",
    problem: null, criteria: null,
    ...over,
  };
}

describe("分享页", () => {
  it("说清是谁发的、哪一版、只读——访客要知道自己看的是不是最新的", async () => {
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
    expect(meta).toContain("2026");
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
    expect(screen.getByTestId("shared-design-frame-1").textContent).toContain("未出图");
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
