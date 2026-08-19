'use strict';

// Varian LOKAL pentadbir MasjidTV. Pelaksanaan penuh berada dalam
// admin/core.ts — fail ini hanya membekalkan konfigurasi varian dan boot.
//
// Ciri lokal (server mini PC di premis):
// - login 'password' (kata laluan admin sahaja → POST /api/admin/login);
// - tiada kad lesen, tiada konsol superuser/TV pairing, tiada susun semula
//   pengumuman atau medan Quran, tiada muat naik Blob (terus ke server).
import './admin/local';
import { bootAdmin } from './admin/core';

bootAdmin({
  features: {}
});
