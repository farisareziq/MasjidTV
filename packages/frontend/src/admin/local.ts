'use strict';

// Varian LOKAL pentadbir MasjidTV — satu-satunya ciri tambahan di luar teras
// ialah pemilih peranti DSHOW (datalist pada medan URL stream), dibekalkan
// oleh devices.json kiosk melalui /api/devices-hw (endpoint LAN tanpa auth —
// hanya nama peranti, tiada rahsia).

import { registerAdminFeatures } from './types';
import type { DshowOption } from './types';
import { dshowDeviceName } from './util';

// Pilihan datalist untuk stream DSHOW pada mesin ini. /api/devices-hw
// memulangkan { dshow: { name }[] } daripada devices.json kiosk; jika fail
// tiada (kiosk belum lapor) ia memulangkan [] — medan kekal teks-bebas.
// fetch digunakan terus (bukan api()) kerana endpoint ini tanpa auth dan
// tidak sepatutnya mencetuskan aliran showLogin() pada 401.
async function dshowOptions(): Promise<DshowOption[]> {
  const res = await fetch('/api/devices-hw');
  if (!res.ok) return [];
  const j = await res.json();
  const names = ((j.dshow || []) as unknown[])
    .map(dshowDeviceName)
    .filter(Boolean);
  return names.map((name) => ({ value: `video=${name}`, label: name }));
}

registerAdminFeatures({ dshowOptions });
