'use strict';

// Varian LOKAL paparan MasjidTV. Pelaksanaan penuh berada dalam
// display-core.ts — fail ini hanya membekalkan konfigurasi varian dan boot.
//
// Ciri khusus lokal (server mini PC di premis):
// - sseHello: SSE /api/events lokal menghantar 'hello' + 'unpaired'; status
//   sseAlive dipapar dalam chip debug (?debug=1) sebagai sse:live/poll.
// - unpaired503: pada HTTP 503 dengan kod DEVICE_UNPAIRED, reload ke /display
//   (server kini mod pairing dan papar kod baharu).
import { bootDisplay } from './display-core';

bootDisplay({
  features: {
    sseHello: true,
    unpaired503: true
  }
});
