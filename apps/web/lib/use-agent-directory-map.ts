"use client";
import * as React from "react";
import { listAgentDirectory, type AgentDirectoryCard } from "./agent-directory";

/**
 * 数字人头像（dh-* 插画）在聊天里的数据源：成员 Agent 目录 `GET /agents/directory`
 * 是唯一带 `avatar.key` 的成员可读端点（`CapabilityListing` 不带头像）。
 *
 * 同一页里 composer 选人器、消息作者头像、升级卡片都要读它——模块级共享一次在途请求，
 * 不让每个挂载点各打一次。失败即空表（调用方回退首字母头像），下次挂载会重试。
 * 只读展示，绝不参与任何授权判定。
 */
type DirectoryMap = ReadonlyMap<string, AgentDirectoryCard>;
const EMPTY: DirectoryMap = new Map();

let shared: Promise<DirectoryMap> | null = null;
let resolved: DirectoryMap | null = null;

function loadShared(fetchDirectory: () => Promise<readonly AgentDirectoryCard[]>): Promise<DirectoryMap> {
  if (!shared) {
    shared = fetchDirectory().then(
      (cards) => { resolved = new Map(cards.map((c) => [c.agentId, c])); return resolved; },
      () => { shared = null; return EMPTY; },
    );
  }
  return shared;
}

/** 测试用：清掉模块缓存。 */
export function resetAgentDirectoryMapCache(): void {
  shared = null;
  resolved = null;
}

export function useAgentDirectoryMap(
  enabled = true,
  fetchDirectory: () => Promise<readonly AgentDirectoryCard[]> = listAgentDirectory,
): DirectoryMap {
  const [map, setMap] = React.useState<DirectoryMap>(() => resolved ?? EMPTY);
  React.useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadShared(fetchDirectory).then((value) => { if (alive) setMap(value); });
    return () => { alive = false; };
  }, [enabled, fetchDirectory]);
  return map;
}
