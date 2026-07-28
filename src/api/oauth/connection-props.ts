import { z } from 'zod';
import { MCP_SCOPE } from './constants';

export const connectionPropsSchema = z.object({
  clientName: z.string().min(1).max(120),
  connectionId: z.string().uuid(),
  scopes: z.array(z.literal(MCP_SCOPE)).length(1),
  userId: z.number().int().positive(),
  workspaceId: z.number().int().positive(),
});

export type ConnectionProps = z.infer<typeof connectionPropsSchema>;
