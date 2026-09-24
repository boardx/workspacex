import { whiteboard as B, whiteboardWorkshopControl as W } from '@repo/contracts';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { WorkshopControlError, type WorkshopControlRepository } from './workshop-control-ports';

function valid(principal: Principal, boardId: string): void {
  assertPrincipal(principal);
  if (!B.BoardId.safeParse(boardId).success) throw new WorkshopControlError('VALIDATION_FAILED');
}
export async function getWorkshopControl(repo: WorkshopControlRepository, principal: Principal, boardId: string) {
  valid(principal, boardId); return W.WorkshopControlState.parse(await repo.get(principal, boardId));
}
export async function setWorkshopFreeze(repo: WorkshopControlRepository, principal: Principal, boardId: string, raw: unknown) {
  valid(principal, boardId); const input = W.SetWorkshopFreeze.safeParse(raw);
  if (!input.success) throw new WorkshopControlError('VALIDATION_FAILED');
  return W.WorkshopControlState.parse(await repo.setFreeze(principal, boardId, input.data));
}
export async function hideWorkshopPhases(repo: WorkshopControlRepository, principal: Principal, boardId: string, raw: unknown) {
  valid(principal, boardId); const input = W.HideWorkshopPhases.safeParse(raw);
  if (!input.success) throw new WorkshopControlError('VALIDATION_FAILED');
  return W.WorkshopControlState.parse(await repo.hidePhases(principal, boardId, input.data));
}
export async function revealWorkshopPhases(repo: WorkshopControlRepository, principal: Principal, boardId: string, raw: unknown) {
  valid(principal, boardId); const input = W.RevealWorkshopPhases.safeParse(raw);
  if (!input.success) throw new WorkshopControlError('VALIDATION_FAILED');
  return W.WorkshopControlState.parse(await repo.revealPhases(principal, boardId, input.data));
}
