export * from './schema.js';
export * from './client.js';

// Re-export the small drizzle-orm surface the apps use so every package
// consumes THE SAME drizzle instance (this package's). This avoids the
// dual-instance type conflicts under pnpm peer contexts (Vercel build).
export { eq, and, or, desc, asc, inArray, sql } from 'drizzle-orm';
