import { z } from 'zod';

export const WorkshopPhaseId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const RequestId = z.string().uuid();

export const WorkshopControlState = z.object({
  frozen: z.boolean(),
  hiddenPhaseIds: z.array(WorkshopPhaseId).max(100),
  revision: z.number().int().nonnegative(),
  updatedBy: z.string().min(1).max(200).nullable(),
  updatedAt: z.string().datetime().nullable(),
}).strict();
export type WorkshopControlState = z.infer<typeof WorkshopControlState>;

export const SetWorkshopFreeze = z.object({ requestId: RequestId, frozen: z.boolean() }).strict();
export type SetWorkshopFreeze = z.infer<typeof SetWorkshopFreeze>;
export const HideWorkshopPhases = z.object({
  requestId: RequestId,
  phaseIds: z.array(WorkshopPhaseId).min(1).max(100).refine(ids => new Set(ids).size === ids.length, 'Unique phases required'),
}).strict();
export type HideWorkshopPhases = z.infer<typeof HideWorkshopPhases>;
export const RevealWorkshopPhases = z.object({ requestId: RequestId }).strict();
export type RevealWorkshopPhases = z.infer<typeof RevealWorkshopPhases>;

const base = '/whiteboards/:boardId/workshop/control';
export const operations = {
  getControl: { method: 'GET', path: base, out: WorkshopControlState },
  setFreeze: { method: 'PUT', path: `${base}/freeze`, in: SetWorkshopFreeze, out: WorkshopControlState },
  hidePhases: { method: 'PUT', path: `${base}/hidden-phases`, in: HideWorkshopPhases, out: WorkshopControlState },
  revealPhases: { method: 'POST', path: `${base}/reveal`, in: RevealWorkshopPhases, out: WorkshopControlState },
} as const;
