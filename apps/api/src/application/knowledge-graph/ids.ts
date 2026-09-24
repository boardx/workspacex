/** 本体行的 id：`<前缀>_<32 位十六进制>`。前缀只为人读日志时一眼看出类型，不承载语义。 */
import { randomUUID } from "node:crypto";

export const newKgId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, "")}`;
