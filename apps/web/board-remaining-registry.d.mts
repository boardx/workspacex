export const BOARD_REMAINING_CASES: readonly Readonly<{file:string;title:string;group:string}>[];
export const BOARD_REMAINING_PROJECT: string;
export const BOARD_REMAINING_FILES: readonly string[];
export const BOARD_REMAINING_GREP: RegExp;
export function remainingAcceptanceVerdict(report:unknown,options?:{collection?:boolean}):{status:string;expected:number;observed:number;groups:Record<string,number>;failures:string[]};
