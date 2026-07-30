/**
 * 反证 fixture（**故意违规**）。
 *
 * 不 import 任何数据库客户端，改成直接调检索层自己拼一个 pack。
 * 这一种是最容易被当成「没违规」的：它看起来完全是内部模块调用。
 * I-24 要求的是**向 Context API 请求** Context Pack，不是自己装一个形状一样的东西——
 * 自装的那个不会留下可重放的 `context_packs` 记录。
 */
import { retrieveCandidates } from "../../src/application/retrieval/retrieve-candidates";

export async function fakePack(query: string) {
  return retrieveCandidates(query);
}
