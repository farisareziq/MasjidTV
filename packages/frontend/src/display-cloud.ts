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
import { bootDisplay } from './display-core';

bootDisplay({
  features: {
    metaKey: true,
    recoverMissingKey: true,
    videoGuard: true
  }
});
