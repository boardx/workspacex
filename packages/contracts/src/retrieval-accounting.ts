import {z} from 'zod';
/** Private server-to-service authority reference. It carries no asserted user, project,
 * provider, callback URL or secret. The API re-derives ownership from the leased run. */
export const RetrievalAccountingContext=z.object({orgId:z.string().min(1).max(200),runId:z.string().min(1).max(200),
 attemptId:z.string().min(1).max(300),leaseEpoch:z.number().int().positive()}).strict();
export type RetrievalAccountingContext=z.infer<typeof RetrievalAccountingContext>;
