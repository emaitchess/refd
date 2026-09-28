import { Database } from 'bun:sqlite';
import migrationJournal from '../../../../drizzle/meta/_journal.json';

// The ordered migration list, derived from the drizzle journal rather than
// written out by hand.
//
// Every test harness that stands up an in-memory D1 needs the full migration
// chain, because a test that omits the newest one silently gets the older
// schema while the code under test selects the newer column. That failure is
// confusing (a SQL error about a column that does exist in the real database)
// and it fires on whoever adds the next migration, not on the person who broke
// it. Eleven harnesses each carried their own copy of this list.
//
// The journal is the same file drizzle-kit reads, so the order and the
// filenames cannot drift from the ones the app applies.

export const MIGRATIONS: string[] = (
  migrationJournal as { entries: { tag: string }[] }
).entries.map((entry) => `${entry.tag}.sql`);

export const migratedSqlite = async (): Promise<Database> => {
  const sqlite = new Database(':memory:');
  for (const file of MIGRATIONS) {
    const sql = await Bun.file(
      new URL(`../../../../drizzle/${file}`, import.meta.url),
    ).text();
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) {
        sqlite.exec(trimmed);
      }
    }
  }
  sqlite.exec('PRAGMA foreign_keys = ON');
  return sqlite;
};
