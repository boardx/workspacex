/**
 * `EngineRunController` —— UC-9 `pausePlanRun` 的远端半边（`usecases.md` 端口表）。
 *
 * `usecases.md` 端口表原话：「`UC-9` 的 cancel（`action=interrupt`）...checkpoint
 * **手动**恢复（`restoreCheckpoint`）本轮不做（裁决 (c)），该端口不含 history/state
 * 恢复」——本接口因此只有一个方法：把一个正在跑的远端 run 打断。「恢复」不是这个
 * 端口的职责（那是正常续跑，见 `usecases.md` UC-13 的实现说明：`resumePlanRun`
 * 复用既有 `acceptHumanMessage` + `executor.kick`，不需要一个专门的引擎恢复端口）。
 */
export interface EngineRunController {
  /**
   * `POST /threads/{remoteThreadId}/runs/{remoteRunId}/cancel?action=interrupt`
   * （`langgraph_api/api/runs.py:1006`，`langgraph-api==0.12.4` 实测，domain.md 三·② 的
   * 证据链）。显式传 `action=interrupt`，不依赖它当前是默认值这件事长期不变。
   * 抛出即视为「暂停失败」，调用方不吞。
   *
   * ⚠ 接的是本仓的 Chat `threadId`，不是远端 thread id——`chatThreadId → remoteThreadId`
   * 的派生（`deriveRemoteThreadId`）留在 infrastructure 层做，application 层不 import
   * `infrastructure/agent-run/deep-agent-model-provider.ts`（洋葱分层，`lint-arch-deps`）。
   */
  cancelRun(chatThreadId: string, remoteRunId: string): Promise<void>;
}

export const ENGINE_RUN_CONTROLLER = Symbol("EngineRunController");
