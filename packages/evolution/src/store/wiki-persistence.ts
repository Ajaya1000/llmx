import Database from 'better-sqlite3';
import type { Ref } from '../types.ts';
import type { WikiRow } from '../wiki-types.ts';

/** Durable storage for wiki rows — the plugin backend is swappable. */
export interface WikiPersistence {
  load(): WikiRow[];
  save(row: WikiRow): void;
  evict(predicate: (row: WikiRow) => boolean): void;
}

/** In-memory persistence (tests). */
export class InMemoryWikiPersistence implements WikiPersistence {
  private rows = new Map<Ref, WikiRow>();

  load(): WikiRow[] {
    return [...this.rows.values()];
  }

  save(row: WikiRow): void {
    this.rows.set(row.id, row);
  }

  evict(predicate: (row: WikiRow) => boolean): void {
    for (const [id, row] of this.rows) {
      if (predicate(row)) this.rows.delete(id);
    }
  }
}

/** SQLite persistence (default backend) — rows stored as JSON, one per row. */
export class SqliteWikiPersistence implements WikiPersistence {
  private readonly db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS wiki_rows (id TEXT PRIMARY KEY, row TEXT NOT NULL)',
    );
  }

  load(): WikiRow[] {
    const rows = this.db.prepare('SELECT row FROM wiki_rows').all() as {
      row: string;
    }[];
    return rows.map((r) => JSON.parse(r.row) as WikiRow);
  }

  save(row: WikiRow): void {
    this.db
      .prepare('INSERT OR REPLACE INTO wiki_rows (id, row) VALUES (?, ?)')
      .run(row.id, JSON.stringify(row));
  }

  evict(predicate: (row: WikiRow) => boolean): void {
    for (const row of this.load()) {
      if (predicate(row)) {
        this.db.prepare('DELETE FROM wiki_rows WHERE id = ?').run(row.id);
      }
    }
  }

  close(): void {
    this.db.close();
  }
}
