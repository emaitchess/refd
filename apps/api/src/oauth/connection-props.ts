import { z } from 'zod';
import { MCP_SCOPE } from './constants';

export const connectionPropsSchema = z.object({
  callbackTarget: z.string().min(1).max(512).optional(),
  clientName: z.string().min(1).max(120),
  connectionId: z.string().uuid(),
  scopes: z.array(z.literal(MCP_SCOPE)).length(1),
  userId: z.number().int().positive(),
  workspaceId: z.number().int().positive(),
  // Present only for personal access tokens: routes principal resolution to
  // the api_tokens mirror row instead of the mcp_connections grant mirror.
  tokenKind: z.literal('pat').optional(),
});

export type ConnectionProps = z.infer<typeof connectionPropsSchema>;
