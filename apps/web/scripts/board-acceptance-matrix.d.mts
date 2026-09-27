export type BoardAcceptanceLane = 'journeys' | 'performance-1k' | 'performance-5k' | 'performance-10k' | 'collaboration-50' | 'storage' | 'import' | 'accessibility' | 'security' | 'api-ws-objectstore' | 'visual' | 'meeting-room';
export const boardAcceptanceMatrix: Array<{lane: BoardAcceptanceLane; requirement: string; status: string; command: string[] | null; reason: string}>;
export const requiredBoardAcceptanceLanes: BoardAcceptanceLane[];
