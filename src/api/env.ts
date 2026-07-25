// `Env` comes from worker-configuration.d.ts (bunx wrangler types).
// Secrets aren't inferable from config — declared here on top.
export type AppEnv = Env & {
  BRIGHTDATA_API_TOKEN: string;
  JWT_SECRET: string;
  // Exa company search — competitor discovery (onboarding). Optional: without
  // it the competitors step soft-fails to manual entry.
  EXA_API_KEY: string;
};

export type AppBindings = { Bindings: AppEnv };
