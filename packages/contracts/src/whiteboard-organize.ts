import {z} from 'zod';
export const BoardOrganizeRequest=z.object({requestId:z.string().uuid(),actorId:z.string().min(1).max(200),objectIds:z.array(z.string().min(1).max(200)).min(2).max(60),expectedRevision:z.object({epoch:z.number().int().positive(),seq:z.number().int().nonnegative()}).strict()}).strict().refine(value=>new Set(value.objectIds).size===value.objectIds.length,'Duplicate selection');
export const BoardClusterResult=z.object({clusters:z.array(z.object({label:z.string().trim().min(1).max(120),objectIds:z.array(z.string().min(1).max(200)).min(1).max(60)}).strict()).min(1).max(12)}).strict();
export const BoardOrganizeActors=z.array(z.object({actorId:z.string(),model:z.string(),skill:z.string()}).strict());
