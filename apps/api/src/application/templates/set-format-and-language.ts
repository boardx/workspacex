/**
 * 用例：形式与语言（F19 / `uc-2-1` R3 步骤 2 + A2，契约 `setFormatAndLanguage`）。
 *
 * 只做编排：调领域函数 `planFormatChange` 算出自动增删，`language` 直接透传——
 * 它只影响产出物与报告模板的生成语言，不产生任何议程环节联动，本用例不对它做校验之外
 * 的处理（校验由契约的 `SessionLanguage` 枚举负责）。
 */
import { templates } from "@repo/contracts";
import type { z } from "zod";
import { planFormatChange, type SessionFormat } from "../../domain/templates/format-language";

export type SetFormatAndLanguageInput = z.infer<typeof templates.operations.setFormatAndLanguage.in>;
export type SetFormatAndLanguageOutput = z.infer<typeof templates.operations.setFormatAndLanguage.out>;

export interface SetFormatAndLanguageParams {
  /** 当前档位对应的基础议程环节数（不含「全线上」自动追加的两个） */
  readonly baseAgendaSegmentCount: number;
  readonly previousFormat: SessionFormat;
  readonly nextFormat: SessionFormat;
}

export function setFormatAndLanguage(input: SetFormatAndLanguageParams): SetFormatAndLanguageOutput {
  const result = planFormatChange(input);
  return {
    agendaSegmentCount: result.agendaSegmentCount,
    autoAdded: [...result.autoAdded],
    autoRemoved: [...result.autoRemoved],
  };
}
