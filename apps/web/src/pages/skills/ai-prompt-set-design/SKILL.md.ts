import type { APIRoute } from 'astro';
import { markdownResponse } from '../../../lib/markdown';
import { AI_PROMPT_SET_DESIGN_SKILL } from '../../../lib/skills/ai-prompt-set-design';

export const GET: APIRoute = () => markdownResponse(AI_PROMPT_SET_DESIGN_SKILL);
