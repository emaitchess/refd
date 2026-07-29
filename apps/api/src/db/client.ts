import { drizzle } from 'drizzle-orm/d1';
import type { AppEnv } from '../env';
import * as schema from './schema';

export const getDb = (env: AppEnv) => drizzle(env.DB, { schema });

export type Db = ReturnType<typeof getDb>;
