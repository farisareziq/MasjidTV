'use strict';

// Varian AWAN pentadbir MasjidTV. Pelaksanaan penuh berada dalam
// admin/core.ts + admin/cloud.ts — fail ini hanya membekalkan konfigurasi
// varian dan boot.
//
// Ciri khusus awan (hosting cloud berbilang masjid):
// - login 'username' (+ aliran PIN superuser, konsol masjid & TV pairing);
// - licenseCard: kad lesen pada overview + borang daftar lesen;
// - annReorder/annQuran/annDoa: susun semula pengumuman & medan Quran/Doa harian;
// - blobUpload: mampatan imej + muat naik Blob berpresign untuk fail besar;
// - headingFont/fridayKhutbah: medan paparan tambahan;
// - tokenRotate: tukar kata laluan mengembalikan token baharu;
// - kioskStreams: relay kamera/cermin melalui kiosk berpasangan (bukan ffmpeg
//   pada hos awan) — nota & label status yang jujur pada kad stream.
import './admin/cloud';
import { bootAdmin } from './admin/core';

bootAdmin({
  features: {
    login: 'username',
    licenseCard: true,
    annReorder: true,
    annQuran: true,
    annDoa: true,
    blobUpload: true,
    headingFont: true,
    fridayKhutbah: true,
    tokenRotate: true,
    kioskStreams: true
  }
});
