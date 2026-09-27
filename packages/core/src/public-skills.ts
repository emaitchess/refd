// The installable agent skills refd publishes, and the one place that decides
// which exist. The agent manifest, llms.txt, llms-full.txt, the agents page
// discovery table, and the MCP server all read this list, because the failure
// mode when they do not is a skill that exists on the site and is invisible to
// every agent-facing surface. Each surface keeps its own wording; only the
// identity and the path are shared.
export const PUBLIC_SKILLS = [
  {
    name: 'refd',
    path: '/skills/refd/SKILL.md',
  },
  {
    name: 'ai-prompt-set-design',
    path: '/skills/ai-prompt-set-design/SKILL.md',
  },
] as const;

export type PublicSkill = (typeof PUBLIC_SKILLS)[number];

export const PUBLIC_SKILL_PATHS: string[] = PUBLIC_SKILLS.map(
  (skill) => skill.path,
);
