import { AI_PROMPT_SET_DESIGN_SKILL } from '@refd/core/prompt-set-skill';
import type { APIRoute } from 'astro';
import { markdownResponse } from '../../../lib/markdown';

export const GET: APIRoute = () => markdownResponse(AI_PROMPT_SET_DESIGN_SKILL);
