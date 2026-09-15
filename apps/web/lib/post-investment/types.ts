/** 同 `lib/ic-review/types.ts` 的形状——示例材料包（纯文本）与预检失败文件。 */
export interface ReportDocument {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface UnparsedFile {
  readonly name: string;
  readonly bytes: number;
  readonly reason: string;
}
