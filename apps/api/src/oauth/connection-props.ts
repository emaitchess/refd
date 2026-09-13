import { z } from 'zod';
import { MCP_SCOPES } from './constants';

const baseConnectionProps = z.object({
  allWorkspaces: z.boolean().optional(),
  callbackTarget: z.string().min(1).max(512).optional(),
  clientName: z.string().min(1).max(120),
  connectionId: z.string().uuid(),
  defaultWorkspaceId: z.number().int().positive().optional(),
  scopes: z.array(z.enum(MCP_SCOPES)).min(1).max(MCP_SCOPES.length),
  userId: z.number().int().positive(),
  workspaceId: z.number().int().positive().optional(),
  // Snapshot read grants: the workspace ids checked at consent time.
  workspaceIds: z.array(z.number().int().positive()).optional(),
  // Present only for personal access tokens: routes principal resolution to
  // the api_tokens mirror row instead of the mcp_connections grant mirror.
  tokenKind: z.literal('pat').optional(),
});

export const connectionPropsSchema = baseConnectionProps.superRefine(
  (value, ctx) => {
    if (value.tokenKind === 'pat') {
      if (
        value.workspaceId === undefined ||
        value.allWorkspaces !== undefined ||
        value.workspaceIds !== undefined ||
        value.defaultWorkspaceId !== undefined
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'a personal access token is scoped to one workspace',
          path: ['workspaceId'],
        });
      }
      return;
    }
    if (value.workspaceId === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'grants carry a default workspace',
        path: ['workspaceId'],
      });
      return;
    }
    if (value.allWorkspaces !== undefined && value.workspaceIds !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'a grant is either all-workspaces or a checked set',
        path: ['allWorkspaces'],
      });
      return;
    }
    if (value.workspaceIds !== undefined) {
      const unique = [...new Set(value.workspaceIds)];
      if (
        unique.length !== value.workspaceIds.length ||
        !unique.includes(value.workspaceId)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'the default workspace must appear in the checked set',
          path: ['workspaceIds'],
        });
      }
    }
  },
);

export type ConnectionProps = z.infer<typeof connectionPropsSchema>;
