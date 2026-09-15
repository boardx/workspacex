/**
 * 上会材料智能审阅助手（/agent/team1）—— 领域类型。
 *
 * MVP 架构（2026-09-15 第二版）：不自建分析引擎与聊天 UI，`/agent/team1` 只负责
 * 「材料预处理 + 把审阅任务投进一条真实项目对话」，真正的比对/交叉验证由真实
 * chat 后端（deep-agent + AGUI，挂载真实模型与 Skill）完成。本文件因此只保留
 * 材料接收阶段需要的形状；四态清单/风险发现等分析结果类型已随规则引擎一起移除
 * ——那是模型的产出，不是前端能提前定形的东西。
 */

/** 用户在落地页选中、准备随审阅任务一起发进对话的一份材料。 */
export interface ReviewDocument {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  /** sha256 十六进制；随材料一起写进出处台账，供报告与后续追溯引用。 */
  readonly sha256: string;
  readonly bytes: number;
}

/** 未能读取的文件——「我没读到」与「材料里没有」必须分开记账。 */
export interface UnparsedFile {
  readonly name: string;
  readonly bytes: number;
  readonly reason: string;
}
