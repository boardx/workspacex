/**
 * `classifyResidue` 的四格覆盖。
 *
 * ⚠ **反空转**：只断言"孤儿被认出来"是不够的——一个「一律判孤儿」的实现会全绿，
 *   然后在真机上清掉别的会话正在用的容器。所以 ⭐ 标记的那几格（该留的真留住了）
 *   才是这份测试的价值所在。本仓已九次踩过"全绿但空转"。
 */
import { describe, expect, it } from "vitest";
import {
  classifyResidue, hasLivingWorktree, worktreeDirsOf, type ContainerRecord,
} from "./lib/docker-residue";

const c = (o: Partial<ContainerRecord> & { name: string }): ContainerRecord => ({
  project: "proj",
  configFiles: "/wt/gone/infra/docker-compose.yml",
  running: false,
  ...o,
});

/** 只有 `/wt/live` 存在；`/wt/gone` 已被删。 */
const dirExists = (p: string): boolean => p === "/wt/live";

describe("classifyResidue —— 判据：起这个栈的 worktree 还在不在", () => {
  it("worktree 已消失 + 无运行中容器 ⇒ 判孤儿（可清）", () => {
    const v = classifyResidue([c({ name: "a-pg", project: "orphaned" })], dirExists);
    expect(v.orphanProjects).toEqual(["orphaned"]);
    expect(v.liveProjects).toEqual([]);
  });

  it("⭐ worktree 仍在 ⇒ 一律保留，哪怕容器已停止（会话可能重启它）", () => {
    const v = classifyResidue(
      [c({ name: "b-pg", project: "paused", configFiles: "/wt/live/infra/docker-compose.yml" })],
      dirExists,
    );
    expect(v.liveProjects).toEqual(["paused"]);
    expect(v.orphanProjects).toEqual([]);
  });

  it("⭐ worktree 已消失但仍有容器在跑 ⇒ 不清（可能是刚删目录、进程还没退）", () => {
    const v = classifyResidue(
      [
        c({ name: "d-pg", project: "dying", running: true }),
        c({ name: "d-redis", project: "dying", running: false }),
      ],
      dirExists,
    );
    expect(v.orphanProjects).toEqual([]);
  });

  it("⭐ 同一项目里有一个容器在跑 ⇒ 整个项目都不清，不是只跳过那一个容器", () => {
    const v = classifyResidue(
      [
        c({ name: "e-pg", project: "mixed", running: true }),
        c({ name: "e-redis", project: "mixed", running: false }),
        c({ name: "e-minio", project: "mixed", running: false }),
      ],
      dirExists,
    );
    expect(v.orphanProjects).not.toContain("mixed");
  });

  it("缺 compose label ⇒ 归入 unclassified，不猜也不清", () => {
    const v = classifyResidue(
      [c({ name: "stray", project: null, configFiles: null })],
      dirExists,
    );
    expect(v.unclassified).toEqual(["stray"]);
    expect(v.orphanProjects).toEqual([]);
  });

  it("装置自检：同一份输入换成「目录都存在」，孤儿必须归零（证明判据真的读了目录）", () => {
    const input = [c({ name: "f-pg", project: "p1" })];
    expect(classifyResidue(input, () => false).orphanProjects).toEqual(["p1"]);
    expect(classifyResidue(input, () => true).orphanProjects).toEqual([]);
  });

  it("worktreeDirsOf 从 compose 路径回推 worktree 根（与 sweep-docker.ts 同一算法）", () => {
    expect(worktreeDirsOf("/tmp/wt-x/infra/docker-compose.yml")).toEqual(["/tmp/wt-x"]);
    expect(worktreeDirsOf("/a/b/c/d/compose.yml")).toEqual(["/a/b/c"]);
  });
});

/**
 * 2026-08-19 真实事故的回归：`ConfigFiles` 是**逗号分隔的多条路径**时，旧实现对整串
 * 取目录 ⇒ 算出伪路径 ⇒ 把**主开发栈**判成孤儿。`--apply` 会 `down -v` 删掉它的数据卷。
 *
 * ⚠ 方向刻意：宁可漏清，不可误删。
 */
describe("hasLivingWorktree —— 多路径 ConfigFiles（真实事故回归）", () => {
  const exists = (alive: readonly string[]) => (p: string) => alive.includes(p);

  it("⭐ 两条路径都存在 ⇒ 不是孤儿（旧实现在这里误判，会删主开发栈）", () => {
    const cfg = "/repo/apps/api/docker-compose.dev.yml,/repo/.claude/worktrees/agent-x/apps/api/docker-compose.dev.yml";
    expect(hasLivingWorktree(cfg, exists(["/repo/apps", "/repo/.claude/worktrees/agent-x/apps"]))).toBe(true);
  });

  it("⭐ 只有一条还在 ⇒ 仍然不是孤儿（任一尚存即有主人）", () => {
    const cfg = "/repo/apps/api/docker-compose.dev.yml,/gone/apps/api/docker-compose.dev.yml";
    expect(hasLivingWorktree(cfg, exists(["/repo/apps"]))).toBe(true);
  });

  it("每一条都消失了 ⇒ 才是孤儿", () => {
    const cfg = "/gone-a/apps/api/docker-compose.dev.yml,/gone-b/apps/api/docker-compose.dev.yml";
    expect(hasLivingWorktree(cfg, exists([]))).toBe(false);
  });

  it("单路径（既有形态）不受影响：存在 ⇒ 非孤儿；消失 ⇒ 孤儿", () => {
    const cfg = "/repo/apps/api/docker-compose.dev.yml";
    expect(hasLivingWorktree(cfg, exists(["/repo/apps"]))).toBe(true);
    expect(hasLivingWorktree(cfg, exists([]))).toBe(false);
  });

  it("装置自检：worktreeDirsOf 真的切出了每一条，不是恒返回一条", () => {
    const dirs = worktreeDirsOf("/a/x/c.yml,/b/y/c.yml");
    expect(dirs).toEqual(["/a", "/b"]);
  });
});

