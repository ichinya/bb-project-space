import { z } from 'zod';
import { spaceSchema } from './model.ts';
export const agentsRequest=z.object({targets:z.array(z.object({path:z.string().min(1).max(2048),spaces:z.array(spaceSchema).min(1).max(80)})).max(400)});
export const agentsResult=z.object({updatedAt:z.number(),results:z.array(z.object({path:z.string(),status:z.enum(['updated','unchanged','removed','error']),message:z.string()}))});
