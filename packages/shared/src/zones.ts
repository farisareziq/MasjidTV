// Senarai zon waktu solat rasmi JAKIM (diambil dari laman e-solat.gov.my).
// Di-port verbatim dari rujukan TVMasjid server/zones.js — berwibawa.

export interface Zone {
  zone: string;
  negeri: string;
  label: string;
}

export const ZONES: Zone[] = [
  { zone: 'JHR01', negeri: 'Johor', label: 'Pulau Aur dan Pulau Pemanggil' },
  { zone: 'JHR02', negeri: 'Johor', label: 'Johor Bahru, Kota Tinggi, Mersing, Kulai' },
  { zone: 'JHR03', negeri: 'Johor', label: 'Kluang, Pontian' },
  { zone: 'JHR04', negeri: 'Johor', label: 'Batu Pahat, Muar, Segamat, Gemas Johor, Tangkak' },
  { zone: 'KDH01', negeri: 'Kedah', label: 'Kota Setar, Kubang Pasu, Pokok Sena (Daerah Kecil)' },
  { zone: 'KDH02', negeri: 'Kedah', label: 'Kuala Muda, Yan, Pendang' },
  { zone: 'KDH03', negeri: 'Kedah', label: 'Padang Terap, Sik' },
  { zone: 'KDH04', negeri: 'Kedah', label: 'Baling' },
  { zone: 'KDH05', negeri: 'Kedah', label: 'Bandar Baharu, Kulim' },
  { zone: 'KDH06', negeri: 'Kedah', label: 'Langkawi' },
  { zone: 'KDH07', negeri: 'Kedah', label: 'Puncak Gunung Jerai' },
  { zone: 'KTN01', negeri: 'Kelantan', label: 'Bachok, Kota Bharu, Machang, Pasir Mas, Pasir Puteh, Tanah Merah, Tumpat, Kuala Krai, Mukim Chiku' },
  { zone: 'KTN02', negeri: 'Kelantan', label: 'Gua Musang (Daerah Galas Dan Bertam), Jeli, Jajahan Kecil Lojing' },
  { zone: 'MLK01', negeri: 'Melaka', label: 'SELURUH NEGERI MELAKA' },
  { zone: 'NGS01', negeri: 'Negeri Sembilan', label: 'Tampin, Jempol' },
  { zone: 'NGS02', negeri: 'Negeri Sembilan', label: 'Jelebu, Kuala Pilah, Rembau' },
  { zone: 'NGS03', negeri: 'Negeri Sembilan', label: 'Port Dickson, Seremban' },
  { zone: 'PHG01', negeri: 'Pahang', label: 'Pulau Tioman' },
  { zone: 'PHG02', negeri: 'Pahang', label: 'Kuantan, Pekan, Muadzam Shah' },
  { zone: 'PHG03', negeri: 'Pahang', label: 'Jerantut, Temerloh, Maran, Bera, Chenor, Jengka' },
  { zone: 'PHG04', negeri: 'Pahang', label: 'Bentong, Lipis, Raub' },
  { zone: 'PHG05', negeri: 'Pahang', label: 'Genting Sempah, Janda Baik, Bukit Tinggi' },
  { zone: 'PHG06', negeri: 'Pahang', label: 'Cameron Highlands, Genting Higlands, Bukit Fraser' },
  { zone: 'PHG07', negeri: 'Pahang', label: 'Zon Khas Daerah Rompin, (Mukim Rompin, Mukim Endau, Mukim Pontian)' },
  { zone: 'PLS01', negeri: 'Perlis', label: 'Kangar, Padang Besar, Arau' },
  { zone: 'PNG01', negeri: 'Pulau Pinang', label: 'Seluruh Negeri Pulau Pinang' },
  { zone: 'PRK01', negeri: 'Perak', label: 'Tapah, Slim River, Tanjung Malim' },
  { zone: 'PRK02', negeri: 'Perak', label: 'Kuala Kangsar, Sg. Siput, Ipoh, Batu Gajah, Kampar' },
  { zone: 'PRK03', negeri: 'Perak', label: 'Lenggong, Pengkalan Hulu, Grik' },
  { zone: 'PRK04', negeri: 'Perak', label: 'Temengor, Belum' },
  { zone: 'PRK05', negeri: 'Perak', label: 'Kg Gajah, Teluk Intan, Bagan Datuk, Seri Iskandar, Beruas, Parit, Lumut, Sitiawan, Pulau Pangkor' },
  { zone: 'PRK06', negeri: 'Perak', label: 'Selama, Taiping, Bagan Serai, Parit Buntar' },
  { zone: 'PRK07', negeri: 'Perak', label: 'Bukit Larut' },
  { zone: 'SBH01', negeri: 'Sabah', label: 'Bahagian Sandakan (Timur), Bukit Garam, Semawang, Temanggong, Tambisan, Bandar Sandakan, Sukau' },
  { zone: 'SBH02', negeri: 'Sabah', label: 'Beluran, Telupid, Pinangah, Terusan, Kuamut, Bahagian Sandakan (Barat)' },
  { zone: 'SBH03', negeri: 'Sabah', label: 'Lahad Datu, Silabukan, Kunak, Sahabat, Semporna, Tungku, Bahagian Tawau (Timur)' },
  { zone: 'SBH04', negeri: 'Sabah', label: 'Bandar Tawau, Balong, Merotai, Kalabakan, Bahagian Tawau (Barat)' },
  { zone: 'SBH05', negeri: 'Sabah', label: 'Kudat, Kota Marudu, Pitas, Pulau Banggi, Bahagian Kudat' },
  { zone: 'SBH06', negeri: 'Sabah', label: 'Gunung Kinabalu' },
  { zone: 'SBH07', negeri: 'Sabah', label: 'Kota Kinabalu, Ranau, Kota Belud, Tuaran, Penampang, Papar, Putatan, Bahagian Pantai Barat' },
  { zone: 'SBH08', negeri: 'Sabah', label: 'Pensiangan, Keningau, Tambunan, Nabawan, Bahagian Pendalaman (Atas)' },
  { zone: 'SBH09', negeri: 'Sabah', label: 'Beaufort, Kuala Penyu, Sipitang, Tenom, Long Pasia, Membakut, Weston, Bahagian Pendalaman (Bawah)' },
  { zone: 'SGR01', negeri: 'Selangor', label: 'Gombak, Petaling, Sepang, Hulu Langat, Hulu Selangor, S.Alam' },
  { zone: 'SGR02', negeri: 'Selangor', label: 'Kuala Selangor, Sabak Bernam' },
  { zone: 'SGR03', negeri: 'Selangor', label: 'Klang, Kuala Langat' },
  { zone: 'SWK01', negeri: 'Sarawak', label: 'Limbang, Lawas, Sundar, Trusan' },
  { zone: 'SWK02', negeri: 'Sarawak', label: 'Miri, Niah, Bekenu, Sibuti, Marudi' },
  { zone: 'SWK03', negeri: 'Sarawak', label: 'Pandan, Belaga, Suai, Tatau, Sebauh, Bintulu' },
  { zone: 'SWK04', negeri: 'Sarawak', label: 'Sibu, Mukah, Dalat, Song, Igan, Oya, Balingian, Kanowit, Kapit' },
  { zone: 'SWK05', negeri: 'Sarawak', label: 'Sarikei, Matu, Julau, Rajang, Daro, Bintangor, Belawai' },
  { zone: 'SWK06', negeri: 'Sarawak', label: 'Lubok Antu, Sri Aman, Roban, Debak, Kabong, Lingga, Engkelili, Betong, Spaoh, Pusa, Saratok' },
  { zone: 'SWK07', negeri: 'Sarawak', label: 'Serian, Simunjan, Samarahan, Sebuyau, Meludam' },
  { zone: 'SWK08', negeri: 'Sarawak', label: 'Kuching, Bau, Lundu, Sematan' },
  { zone: 'SWK09', negeri: 'Sarawak', label: 'Zon Khas (Kampung Patarikan)' },
  { zone: 'TRG01', negeri: 'Terengganu', label: 'Kuala Terengganu, Marang, Kuala Nerus' },
  { zone: 'TRG02', negeri: 'Terengganu', label: 'Besut, Setiu' },
  { zone: 'TRG03', negeri: 'Terengganu', label: 'Hulu Terengganu' },
  { zone: 'TRG04', negeri: 'Terengganu', label: 'Dungun, Kemaman' },
  { zone: 'WLY01', negeri: 'Wilayah Persekutuan', label: 'Kuala Lumpur, Putrajaya' },
  { zone: 'WLY02', negeri: 'Wilayah Persekutuan', label: 'Labuan' }
];

const BY_CODE = new Map(ZONES.map((z) => [z.zone, z]));

export function getZone(code: string): Zone | null {
  return BY_CODE.get(code) ?? null;
}

export function getZonesGrouped(): Record<string, Zone[]> {
  const groups: Record<string, Zone[]> = {};
  for (const z of ZONES) {
    (groups[z.negeri] ||= []).push(z);
  }
  return groups;
}
