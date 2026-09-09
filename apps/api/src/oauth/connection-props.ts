import { z } from 'zod';
import { MCP_SCOPES } from './constants';

export const connectionPropsSchema = z.object({
  callbackTarget: z.string().min(1).max(512).optional(),
  clientName: z.string().min(1).max(120),
  connectionId: z.string().uuid(),
  scopes: z.array(z.enum(MCP_SCOPES)).min(1).max(MCP_SCOPES.length),
  userId: z.number().int().positive(),
  workspaceId: z.number().int().positive(),
});

export type ConnectionProps = z.infer<typeof connectionPropsSchema>;
