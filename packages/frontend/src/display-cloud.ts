'use strict';

// Varian AWAN paparan MasjidTV. Pelaksanaan penuh berada dalam
// display-core.ts — fail ini hanya membekalkan konfigurasi varian dan boot.
//
// Ciri khusus awan (hosting cloud + domain khas):
// - metaKey: domain khas (mis. tvdisplay.masjidlabis.my) menyuntik kunci
//   melalui <meta name="tvm-key"> — baca meta dan kemas kini URL.
// - recoverMissingKey: paparan lama tanpa kunci (kiosk/Android TV) muat
//   semula sekali (had 5 minit) untuk pulih sendiri apabila API balas 401.
// - videoGuard: jaring keselamatan slaid video — jika acara 'ended' tidak
//   tercetus (video tersekat), tukar slaid selepas tempoh munasabah.
// - sseEnabled:true: SSE /api/events aktif secara lalai. Pada Vercel, pelayan
//   menjawab 204 (MASJIDTV_DISABLE_SSE=1) — EventSource berhenti menyambung
//   semula secara kekal sisi spesifikasi, jadi kos serverless kekal rendah.
//   Pada VPS (proses panjang), SSE memberi sync segera <2sa admin->TV.
// - syncIntervalMs:60000: poll fallback setiap 60sa. Dengan SSE hidup, poll
//   hanya keselamatan jaring; pada Vercel (SSE mati) ia kadar utama.
import { bootDisplay } from './display-core';

bootDisplay({
  features: {
    metaKey: true,
    recoverMissingKey: true,
    videoGuard: true,
    sseEnabled: true,
    syncIntervalMs: 60000
  }
});
