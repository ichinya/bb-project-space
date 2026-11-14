import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const workspaceRoot=z.object({path:z.string().min(1).max(2048),name:z.string().min(1).max(100)});
export const workspaceStatus=z.object({
  available:z.boolean(),version:z.string().nullable(),group:z.string(),error:z.string().nullable(),
  folders:z.array(z.object({path:z.string(),name:z.string(),exists:z.boolean(),initialized:z.boolean(),groups:z.array(z.string()),configPath:z.string(),configExists:z.boolean(),configGroups:z.array(z.string()),error:z.string().nullable()})),
});
export const workspaceRequest=z.object({spaceId:z.string().uuid(),group:z.string().trim().max(100),roots:z.array(workspaceRoot).min(1).max(80)});
export const workspaceSoftware=z.object({installedVersion:z.string().nullable(),binary:z.string().nullable(),managed:z.boolean(),latestVersion:z.string().nullable(),releaseUrl:z.string().nullable(),checkedAt:z.number().nullable(),updateAvailable:z.boolean(),supported:z.boolean(),error:z.string().nullable()});
export const workspaceHostContract=defineRpcContract({
  software:{input:z.object({checkLatest:z.boolean()}),output:workspaceSoftware},
  install:{input:z.object({}),output:workspaceSoftware},
  inspect:{input:workspaceRequest,output:workspaceStatus},
  synchronize:{input:workspaceRequest,output:z.object({status:workspaceStatus,results:z.array(z.object({path:z.string(),ok:z.boolean(),message:z.string()}))})},
  mcp:{input:z.object({group:z.string().min(1).max(100),cwd:z.string().min(1),method:z.enum(['tools/list','tools/call']),tool:z.string().optional(),arguments:z.record(z.string(),z.unknown()).optional()}),output:z.unknown()},
});
