// Deklarasi jenis minimum untuk 'node:sqlite' — @types/node@20 belum
// memasukkannya (stabil sebagai experimental sejak Node 22.5). Hanya
// surface yang digunakan shim wrapNodeSqlite dalam client.ts.

declare module 'node:sqlite' {
  interface StatementSync {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    iterate(...params: unknown[]): IterableIterator<unknown>;
  }
  class DatabaseSync {
    constructor(path: string, options?: { open?: boolean });
    open(): void;
    close(): void;
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    function(name: string, fn: (...args: unknown[]) => unknown): void;
  }
}
