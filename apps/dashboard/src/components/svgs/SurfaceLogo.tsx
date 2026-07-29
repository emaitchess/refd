import type { ComponentType } from 'react';
import Gemini from './Gemini';
import GoogleAIMode from './GoogleAIMode';
import GoogleAIOverview from './GoogleAIOverview';
import OpenAI from './OpenAI';
import Perplexity from './Perplexity';

// Surface key → provider logo. All logos are currentColor, so they inherit the
// surrounding text color (monochrome chrome).
const LOGOS: Record<string, ComponentType<{ className?: string }>> = {
  chatgpt: OpenAI,
  perplexity: Perplexity,
  gemini: Gemini,
  google_ai_mode: GoogleAIMode,
  google_aio: GoogleAIOverview,
};

export const SurfaceLogo = ({
  surface,
  className,
}: {
  surface: string;
  className?: string;
}) => {
  const Logo = LOGOS[surface];
  return Logo ? <Logo className={className} /> : null;
};
