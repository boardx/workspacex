"use client";
import * as React from "react";
import { isScrolledNearBottom } from "@/lib/copilotkit-v2-scroll";
export function useTimelineScroll(messages: unknown) {
  /**
   * issue #2071 —— 消息区没有"跳到最新"手段：新消息到达时不自动贴底，长线程往上翻阅
   * 后也没有回到底部的入口，只能手动拖滚动条。做法对齐 Slack/Discord/ChatGPT 的常见
   * 约定（`CopilotChatView.ScrollView` 库内置的 `pin-to-bottom` 语义同款做法，本仓
   * 选自己写而不是接那个组件——见下方"为什么不用库自带 ScrollView"）：贴底时新消息
   * 自动跟随；一旦往上翻离开底部，自动跟随停止，改为在消息区右下角浮现"↓回到最新"
   * 按钮；键盘 `Cmd/Ctrl+End` 随时可跳回底部，与输入框里普通 `End`（移到行尾）不冲突
   * （只认组合键）。
   *
   * ## 为什么不直接接库自带的 `CopilotChatView.ScrollView`
   *
   * 它确实自带同款语义（`autoScroll="pin-to-bottom"` + `scrollToBottomButton` slot），
   * 但它的测量假设（`inputContainerHeight`/`feather`）是围绕"composer 本身也在
   * ScrollView 内"设计的，本面板 composer 在这个滚动容器**外面**自绘（下方错误横幅、
   * composer 区块都在 `overflow-y-auto` 容器之外）——接入前没有把握它的内部布局假设
   * 不会跟 #2039 三轮 UIUX 迭代过的布局打架。手写这套（滚动位置判定 + 条件贴底 +
   * 悬浮按钮）改动可预期，不依赖库的内部测量逻辑。
   */
  const messagesContainerRef = React.useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = React.useState(true);
  /**
   * issue #3145 —— `isAtBottom` 的**同步**镜像。两个自动跟随的 effect（新消息跟随、
   * 内容长高跟随）都通过它判定，而不是只看那个 state。
   *
   * 为什么不能只看 state：`setIsAtBottom(false)` 是异步的，而流式期间**每一个 delta**
   * 都会让跟随 effect 重跑一次。用户滚轮翻上去之后、React 提交那次 state 之前到达的
   * delta，跟随 effect 读到的还是**旧的** `isAtBottom === true`，于是把人一把拽回底部；
   * `ResizeObserver` 那条更糟——它的回调闭包是在贴底那次渲染里建的，只要还没重新
   * 注册，内容每长高一次就拽一次。ref 在事件处理器里同步写，两条路径都读它，
   * 这个窗口就不存在了。
   */
  const isAtBottomRef = React.useRef(true);
  /**
   * 2026-09-02 人类实测反馈："滚到底部的那个箭头的逻辑是错误的"。两处根因：
   *
   * ① 按钮此前是滚动容器（`overflow-y-auto`）自己的 `absolute` 子节点。绝对定位的
   *    后代仍然属于滚动容器的**可滚动内容**——`bottom-3` 只是相对容器*初始*那一屏
   *    的 padding box 定位，用户往上翻一屏之后，按钮跟着内容一起滚走：要么消失，
   *    要么停在某条消息中间（截图里它正压在气泡正中）。修法：按钮搬到滚动容器
   *    **外面**，与它并列在一个 `relative` 包装层里，才真正钉在可视区底部。
   *
   * ② 程序化滚动（点按钮/新消息自动跟随，`behavior:"smooth"`）会在动画途中连续
   *    触发 `scroll` 事件，中间位置离底部还远，`handleMessagesScroll` 把 `isAtBottom`
   *    翻回 `false`——按钮刚点掉又冒出来；流式增量时更糟：每个 delta 都起一次平滑
   *    滚动，动画途中的 `scroll` 事件把"贴底"判成"用户往上翻了"，自动跟随就此
   *    停止，用户明明没动过滚轮却看到箭头浮现、回复自己滚出视野。修法：
   *    `programmaticScrollRef` 标记"这次滚动是我们发起的"，动画途中的 `scroll`
   *    事件不把 `isAtBottom` 翻成 false，直到真的抵达底部（或用户以滚轮/触摸/键盘
   *    介入——那才是"用户往上翻"的证据）才解除；自动跟随改用 `auto`（瞬时），
   *    Slack/Discord 的贴底跟随本来就是瞬时的，平滑只留给用户主动点按钮那一次。
   *
   * ③ 内容在没有新消息的情况下长高（图表/画布进入视口后惰性渲染、图片加载），
   *    不会触发 `scroll` 事件也不会改变 `messages`：贴底态下用 `ResizeObserver`
   *    盯住内容包装层，长高就补一次瞬时贴底，保持"贴底"这个承诺。
   */
  const messagesContentRef = React.useRef<HTMLDivElement | null>(null);
  const programmaticScrollRef = React.useRef(false);
  const programmaticScrollTimerRef = React.useRef<number | null>(null);
  /**
   * issue #3145 —— 最近一次"用户亲手介入"的时刻。**用户意图压过程序化标记**：这个
   * 窗口内到达的 `scroll` 事件一律按用户滚动处理，哪怕 `programmaticScrollRef` 是 true。
   *
   * 没有它时，解除只有一次机会、还得赢一场竞态：滚轮触发 `onWheel` 清掉标记，但浏览器
   * 的 `scroll` 事件要晚一拍才到；流式期间下一个 delta 在这一拍里把标记**重新**置位，
   * 于是用户那次滚动的 `scroll` 事件被当成"程序化滚动途中"直接吞掉，`isAtBottom`
   * 永远翻不成 false，跟随 effect 继续把人按在底部——真栈 e2e（S8）逐字复现的就是
   * 这一幕：`page.mouse.wheel(0, -100000)` 之后 30 秒内 `scrollTop` 从未回到 0
   * （实测停在 1146 / 7206，两趟不同 SHA 相同形状）。
   *
   * 窗口取 150ms：一次滚轮/触摸/按键引发的 `scroll` 事件必然在这之内到达，而它远短于
   * 平滑滚动动画（`PROGRAMMATIC_SCROLL_MAX_MS` = 1000ms），不会把动画途中的中间位置
   * 误判成用户离开底部——那正是 ② 当初要挡的东西。
   */
  const userScrollIntentAtRef = React.useRef(0);
  const USER_SCROLL_INTENT_WINDOW_MS = 150;

  /**
   * PR #2530 review（exact-SHA reviewer 第 1 条）—— 这个标记不能只靠"抵达底部的
   * `scroll` 事件"或"滚轮/触摸/键盘"来解除：`auto` 滚动在位置没变时根本不发
   * `scroll` 事件，用户拖滚动条滑块（pointer）也不是 wheel/touch。标记一旦卡住，
   * 后面用户真实往上翻的 `scroll` 会被当成"程序化途中"吞掉——按钮不出现、内容
   * 长高还把人拉回底部。所以解除条件是四个里**任一**：抵达底部的 `scroll`、
   * `scrollend`（支持的浏览器）、pointer/滚轮/触摸/键盘介入、以及一个有界超时
   * （平滑滚动动画不会超过这个时长；`auto` 立即完成）。`setProgrammaticScroll`
   * 是唯一的置位入口，置位同时起表；`clearProgrammaticScroll` 是唯一的解除入口。
   */
  const PROGRAMMATIC_SCROLL_MAX_MS = 1_000;
  const clearProgrammaticScroll = React.useCallback(() => {
    programmaticScrollRef.current = false;
    if (programmaticScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = null;
    }
  }, []);
  const setProgrammaticScroll = React.useCallback(() => {
    if (programmaticScrollTimerRef.current !== null) window.clearTimeout(programmaticScrollTimerRef.current);
    programmaticScrollRef.current = true;
    programmaticScrollTimerRef.current = window.setTimeout(clearProgrammaticScroll, PROGRAMMATIC_SCROLL_MAX_MS);
  }, [clearProgrammaticScroll]);
  React.useEffect(() => clearProgrammaticScroll, [clearProgrammaticScroll]);

  const scrollMessagesToBottom = React.useCallback((behavior: ScrollBehavior) => {
    const el = messagesContainerRef.current;
    // jsdom（组件测试环境）不实现 `Element.scrollTo`——与下面 `matchMedia` 同一类
    // "真实浏览器才有、测试环境没有"的能力守卫，不是本功能的正常路径分支。
    if (el === null || typeof el.scrollTo !== "function") return;
    setProgrammaticScroll();
    el.scrollTo({ top: el.scrollHeight, behavior });
    isAtBottomRef.current = true;
    setIsAtBottom(true);
  }, [setProgrammaticScroll]);

  const prefersReducedMotion = React.useCallback((): boolean => {
    // 与 `use-section-navigation.ts` 同一处守卫——jsdom 测试环境不提供 `matchMedia`。
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const handleMessagesScroll = React.useCallback(() => {
    const el = messagesContainerRef.current;
    if (el === null) return;
    const nearBottom = isScrolledNearBottom(el.scrollHeight, el.scrollTop, el.clientHeight);
    // #3145：用户刚亲手介入过 ⇒ 这次滚动就是他的，程序化标记不得吞掉它（见
    // `userScrollIntentAtRef` 的头注：吞掉一次就再也没有第二次机会）。
    const userDriven = Date.now() - userScrollIntentAtRef.current <= USER_SCROLL_INTENT_WINDOW_MS;
    if (programmaticScrollRef.current && !userDriven) {
      // 我们自己发起的滚动还在路上：中间位置不算"用户离开了底部"。抵达即解除标记。
      if (nearBottom) clearProgrammaticScroll();
      return;
    }
    if (userDriven) clearProgrammaticScroll();
    isAtBottomRef.current = nearBottom;
    setIsAtBottom(nearBottom);
  }, [clearProgrammaticScroll]);

  // 用户主动介入（滚轮 / 触摸 / 方向键 / 按下指针拖滚动条）即刻解除"程序化滚动中"
  // 标记——之后的 `scroll` 事件才是用户意图的真实信号。
  const handleUserScrollIntent = React.useCallback(() => {
    userScrollIntentAtRef.current = Date.now();
    clearProgrammaticScroll();
  }, [clearProgrammaticScroll]);

  // `scrollend`（Chrome 114+/Firefox 109+；Safari 尚无）：平滑滚动真正结束的权威信号。
  // 不支持的浏览器由上面的有界超时兜底。React 还没有 `onScrollEnd` prop，手动挂。
  React.useEffect(() => {
    const el = messagesContainerRef.current;
    if (el === null) return;
    el.addEventListener("scrollend", clearProgrammaticScroll);
    return () => el.removeEventListener("scrollend", clearProgrammaticScroll);
  }, [clearProgrammaticScroll]);

  // 贴底时新消息/流式增量到达自动跟随；一旦用户往上翻（`isAtBottom` 变 false），
  // 这个 effect 直接不跑，不打断阅读——与 Slack/Discord 同一条纪律。
  React.useEffect(() => {
    // #3145：`isAtBottomRef` 是同步真相，`isAtBottom` 只是触发重跑的依赖——这一拍读到的
    // state 可能还是用户滚轮之前的旧值（见该 ref 的头注）。
    if (!isAtBottom || !isAtBottomRef.current) return;
    const el = messagesContainerRef.current;
    if (el === null || typeof el.scrollTo !== "function") return;
    setProgrammaticScroll();
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [messages, isAtBottom, setProgrammaticScroll]);

  // 见上方 ③：贴底态下内容长高（惰性渲染的图表、加载完的图片）也要跟住。
  React.useEffect(() => {
    if (!isAtBottom) return;
    const content = messagesContentRef.current;
    const el = messagesContainerRef.current;
    if (content === null || el === null || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      // #3145：这个闭包是在贴底那次渲染里建的，注销要等 effect 重跑；用户已经翻上去
      // 之后内容再长高一次，就会被它拽回底部。同步真相在 ref 上。
      if (!isAtBottomRef.current) return;
      if (typeof el.scrollTo !== "function") return;
      setProgrammaticScroll();
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [isAtBottom, setProgrammaticScroll]);

  // `Cmd/Ctrl+End` 跳到最新——只认组合键，不拦截输入框里普通 `End`（移到行尾）。
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "End" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      scrollMessagesToBottom(prefersReducedMotion() ? "auto" : "smooth");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scrollMessagesToBottom, prefersReducedMotion]);

  return { messagesContainerRef, messagesContentRef, isAtBottom, handleMessagesScroll, handleUserScrollIntent, scrollMessagesToBottom, prefersReducedMotion };
}
