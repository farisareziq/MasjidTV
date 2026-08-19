 // Konteks pergantungan dikongsi oleh semua modul laluan. app.ts membina objek
// ini sekali dan menyerahkannya kepada setiap register* — elak parameter berulang.

import type { CloudDatabase } from '@masjidtv/db';
import type { CloudStore } from '../store.js';

export interface RouteContext {
  db: CloudDatabase;
  store: CloudStore;
  startedAt: number;
}
