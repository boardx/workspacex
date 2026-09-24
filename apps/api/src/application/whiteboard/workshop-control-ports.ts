import type { whiteboardWorkshopControl as W } from '@repo/contracts';
import type { Principal } from '../../domain/principal';

export const WORKSHOP_CONTROL_REPOSITORY = Symbol('WorkshopControlRepository');
export type WorkshopControlErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'IDEMPOTENCY_CONFLICT' | 'VALIDATION_FAILED';
export class WorkshopControlError extends Error {
  constructor(readonly code: WorkshopControlErrorCode) { super(code); this.name = 'WorkshopControlError'; }
}
export interface WorkshopControlRepository {
  get(principal: Principal, boardId: string): Promise<W.WorkshopControlState>;
  setFreeze(principal: Principal, boardId: string, input: W.SetWorkshopFreeze): Promise<W.WorkshopControlState>;
  hidePhases(principal: Principal, boardId: string, input: W.HideWorkshopPhases): Promise<W.WorkshopControlState>;
  revealPhases(principal: Principal, boardId: string, input: W.RevealWorkshopPhases): Promise<W.WorkshopControlState>;
}
