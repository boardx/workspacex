/**
 * 「这个版次做不到什么」要说在入口处（#3872 R3）。
 *
 * 实测安装版：本地版的能力选择器里「图片生成」写着**就绪**，
 * 而契约里 `image-generation` 在本地版是 absent、后端也不注册出图 provider。
 */
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EditionProvider } from "@/lib/edition";
import { CapabilityEditionNote } from "@/components/chat/capability-edition-note";

afterEach(cleanup);

const withEdition = (edition: "local" | "cloud") =>
  render(
    <EditionProvider edition={edition} cloudUrl={null}>
      <CapabilityEditionNote />
    </EditionProvider>,
  );

describe("版次能力说明", () => {
  it("本地版在入口处列出做不到的事，点名出图和子代理", () => {
    withEdition("local");
    const box = screen.getByTestId("capability-edition-note");
    expect(box.textContent).toContain("做不到");
    // 这两项都在选择器里被标成「就绪」，而矩阵说本地版没有——说清楚是修掉那条矛盾的第一步。
    expect(screen.getByTestId("capability-edition-absent-image-generation")).toBeTruthy();
    expect(screen.getByTestId("capability-edition-absent-subagents")).toBeTruthy();
  });

  it("列的是 absent 的那些，不是所有有差异的——「有限」不等于「做不到」", () => {
    withEdition("local");
    // audit-provenance 在两边都是 limited，不该出现在「做不到」里
    expect(screen.queryByTestId("capability-edition-absent-audit-provenance")).toBeNull();
  });

  it("也说清楚替代路径，不只是列一串否定", () => {
    withEdition("local");
    expect(screen.getByTestId("capability-edition-note").textContent).toMatch(/在线正式系统/);
  });

  it("云端版列的是云端做不到的那项，不是把本地的清单原样搬过去", () => {
    // 我第一版把这条写成「云端版不画」，那是错的：矩阵里 `offline`（断网可用）
    // 在云端就是 absent。反证时这条真的红了，才发现自己的前提错了——
    // 而当时之所以「看起来对」，是因为有一道冗余判断替我兜住了。
    withEdition("cloud");
    expect(screen.getByTestId("capability-edition-absent-offline")).toBeTruthy();
    expect(screen.queryByTestId("capability-edition-absent-image-generation")).toBeNull();
  });
});
