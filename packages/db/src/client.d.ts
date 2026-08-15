import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { type LibSQLDatabase } from 'drizzle-orm/libsql';
import { createClient as createLibsqlClient } from '@libsql/client';
import Database from 'better-sqlite3';
import * as schema from './schema.js';
export type LocalDatabase = BetterSQLite3Database<typeof schema>;
export type CloudDatabase = LibSQLDatabase<typeof schema>;
export interface LocalClient {
    kind: 'local';
    raw: Database.Database;
    db: LocalDatabase;
    close: () => void;
}
export interface CloudClient {
    kind: 'cloud';
    raw: ReturnType<typeof createLibsqlClient>;
    db: CloudDatabase;
    close: () => void;
}
export type AppClient = LocalClient | CloudClient;
export declare function createLocalClient(filePath: string): LocalClient;
export declare function createMemoryClient(): LocalClient;
export declare function createCloudClient(url: string, authToken?: string): CloudClient;
export declare function applySchema(client: AppClient): void;
