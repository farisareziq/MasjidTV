// Doa Harian — 31 doa daripada al-Quran & hadis sahih, satu doa setiap
// haribulan (kitaran bulanan, auto-renew semula pada setiap 1 haribulan).
// Pentadbir boleh guna doa ini terus (kategori "doa" + doaDaily) atau
// mengatasi (override) dengan doa sendiri melalui medan arabic/translation/ref.

import type { Announcement } from './types.js';

export interface DailyDoa {
  arabic: string;
  text_ms: string;
  text_en: string;
  ref: string;
}

// Susunan mengikut cadangan yang diluluskan: #1-#31, satu doa setiap haribulan.
export const DOAS: DailyDoa[] = [
  {
    arabic: 'اللَّهُمَّ افْتَحْ لِي أَبْوَابَ رَحْمَتِكَ',
    text_ms: 'Ya Allah, bukakanlah bagiku pintu-pintu rahmat-Mu. (doa masuk masjid)',
    text_en: 'O Allah, open for me the doors of Your mercy. (entering the mosque)',
    ref: 'Riwayat Abu Dawud & Muslim'
  },
  {
    arabic: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ مِنْ فَضْلِكَ',
    text_ms: 'Ya Allah, sesungguhnya aku memohon daripada limpah kurnia-Mu. (doa keluar masjid)',
    text_en: 'O Allah, I ask You from Your bounty. (leaving the mosque)',
    ref: 'Riwayat Abu Dawud & Muslim'
  },
  {
    arabic: 'اللَّهُمَّ رَبَّ هَذِهِ الدَّعْوَةِ التَّامَّةِ وَالصَّلَاةِ الْقَائِمَةِ آتِ مُحَمَّدًا الْوَسِيلَةَ وَالْفَضِيلَةَ وَابْعَثْهُ مَقَامًا مَحْمُودًا الَّذِي وَعَدْتَهُ',
    text_ms: 'Ya Allah, Tuhan pemilik seruan yang sempurna ini dan solat yang ditegakkan, berikanlah kepada Nabi Muhammad kedudukan wasilah dan kelebihan, serta bangkitkanlah baginda pada kedudukan terpuji yang telah Engkau janjikan. (doa selepas azan)',
    text_en: 'O Allah, Lord of this perfect call and the prayer to be offered, grant Muhammad the intercession and favour, and raise him to the honoured station You have promised him. (after the adhan)',
    ref: 'Riwayat Bukhari'
  },
  {
    arabic: 'اللَّهُمَّ بِكَ أَصْبَحْنَا وَبِكَ أَمْسَيْنَا وَبِكَ نَحْيَا وَبِكَ نَمُوتُ وَإِلَيْكَ النُّشُورُ',
    text_ms: 'Ya Allah, dengan-Mu kami menghadapi pagi dan petang, dengan-Mu kami hidup dan mati, dan kepada-Mu tempat kembali. (doa pagi)',
    text_en: 'O Allah, by You we enter the morning and the evening, by You we live and die, and to You is the return. (morning)',
    ref: 'Riwayat Abu Dawud & Tirmizi'
  },
  {
    arabic: 'اللَّهُمَّ بِكَ أَمْسَيْنَا وَبِكَ أَصْبَحْنَا وَبِكَ نَحْيَا وَبِكَ نَمُوتُ وَإِلَيْكَ الْمَصِيرُ',
    text_ms: 'Ya Allah, dengan-Mu kami menghadapi petang dan pagi, dengan-Mu kami hidup dan mati, dan kepada-Mu tempat kembali. (doa petang)',
    text_en: 'O Allah, by You we enter the evening and the morning, by You we live and die, and to You is the destination. (evening)',
    ref: 'Riwayat Abu Dawud & Tirmizi'
  },
  {
    arabic: 'أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ',
    text_ms: 'Aku berlindung dengan kalimat-kalimat Allah yang sempurna daripada kejahatan makhluk yang Dia ciptakan. (perlindungan pagi & petang)',
    text_en: 'I seek refuge in the perfect words of Allah from the evil of what He has created. (morning & evening protection)',
    ref: 'Riwayat Muslim'
  },
  {
    arabic: 'بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا',
    text_ms: 'Dengan nama-Mu ya Allah aku mati dan aku hidup. (doa sebelum tidur)',
    text_en: 'In Your name, O Allah, I die and I live. (before sleeping)',
    ref: 'Riwayat Bukhari'
  },
  {
    arabic: 'الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ',
    text_ms: 'Segala puji bagi Allah yang menghidupkan kami setelah mematikan kami, dan kepada-Nya tempat kembali. (doa bangun tidur)',
    text_en: 'All praise is for Allah who gave us life after having taken it from us, and unto Him is the resurrection. (waking up)',
    ref: 'Riwayat Bukhari'
  },
  {
    arabic: 'بِسْمِ اللَّهِ وَعَلَى بَرَكَةِ اللَّهِ',
    text_ms: 'Dengan nama Allah dan atas keberkatan Allah. (doa sebelum makan)',
    text_en: 'In the name of Allah and with the blessing of Allah. (before eating)',
    ref: 'Riwayat Abu Dawud & Tirmizi'
  },
  {
    arabic: 'الْحَمْدُ لِلَّهِ الَّذِي أَطْعَمَنِي هَذَا وَرَزَقَنِيهِ مِنْ غَيْرِ حَوْلٍ مِنِّي وَلَا قُوَّةٍ',
    text_ms: 'Segala puji bagi Allah yang memberiku makanan ini dan mengurniakannya kepadaku tanpa daya dan kekuatanku. (doa selepas makan)',
    text_en: 'All praise is for Allah who fed me this and provided it for me without any effort or power on my part. (after eating)',
    ref: 'Riwayat Abu Dawud & Tirmizi'
  },
  {
    arabic: 'بِسْمِ اللَّهِ وَلَجْنَا وَبِسْمِ اللَّهِ خَرَجْنَا وَعَلَى رَبِّنَا تَوَكَّلْنَا',
    text_ms: 'Dengan nama Allah kami masuk, dan dengan nama Allah kami keluar, dan kepada Tuhan kami kami bertawakal. (doa masuk rumah)',
    text_en: 'In the name of Allah we enter, in the name of Allah we leave, and upon our Lord we place our trust. (entering the home)',
    ref: 'Riwayat Abu Dawud'
  },
  {
    arabic: 'بِسْمِ اللَّهِ تَوَكَّلْتُ عَلَى اللَّهِ لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ',
    text_ms: 'Dengan nama Allah, aku bertawakal kepada Allah; tiada daya dan kekuatan melainkan dengan pertolongan Allah. (doa keluar rumah)',
    text_en: 'In the name of Allah, I place my trust in Allah; there is no might nor power except with Allah. (leaving the home)',
    ref: 'Riwayat Abu Dawud & Tirmizi'
  },
  {
    arabic: 'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْخُبُثِ وَالْخَبَائِثِ',
    text_ms: 'Ya Allah, sesungguhnya aku berlindung dengan-Mu daripada syaitan lelaki dan syaitan perempuan. (doa masuk tandas)',
    text_en: 'O Allah, I seek refuge with You from evil male and female devils. (entering the toilet)',
    ref: 'Riwayat Bukhari & Muslim'
  },
  {
    arabic: 'غُفْرَانَكَ',
    text_ms: 'Aku memohon keampunan-Mu. (doa keluar tandas)',
    text_en: 'I seek Your forgiveness. (leaving the toilet)',
    ref: 'Riwayat Abu Dawud & Tirmizi'
  },
  {
    arabic: 'الْحَمْدُ لِلَّهِ الَّذِي كَسَانِي هَذَا وَرَزَقَنِيهِ مِنْ غَيْرِ حَوْلٍ مِنِّي وَلَا قُوَّةٍ',
    text_ms: 'Segala puji bagi Allah yang memakaikan aku ini dan mengurniakannya kepadaku tanpa daya dan kekuatanku. (doa memakai pakaian)',
    text_en: 'All praise is for Allah who clothed me in this and provided it for me without any effort or power on my part. (wearing clothes)',
    ref: 'Riwayat Abu Dawud'
  },
  {
    arabic: 'اللَّهُمَّ لَكَ الْحَمْدُ أَنْتَ كَسَوْتَنِيهِ أَسْأَلُكَ مِنْ خَيْرِهِ وَخَيْرِ مَا صُنِعَ لَهُ وَأَعُوذُ بِكَ مِنْ شَرِّهِ وَشَرِّ مَا صُنِعَ لَهُ',
    text_ms: 'Ya Allah, bagi-Mu segala puji, Engkaulah yang memakaikanku dengannya; aku memohon kebaikannya dan kebaikan tujuannya, dan aku berlindung dengan-Mu daripada kejahatannya dan kejahatan tujuannya. (doa pakaian baharu)',
    text_en: 'O Allah, all praise is Yours; You have clothed me with it. I ask You for its goodness and the goodness for which it was made, and I seek refuge with You from its evil and the evil for which it was made. (new clothes)',
    ref: 'Riwayat Abu Dawud & Tirmizi'
  },
  {
    arabic: 'رَبِّ زِدْنِي عِلْمًا',
    text_ms: 'Wahai Tuhanku, tambahkanlah ilmuku.',
    text_en: 'My Lord, increase me in knowledge.',
    ref: 'Taha 20:114'
  },
  {
    arabic: 'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنْ عِلْمٍ لَا يَنْفَعُ وَمِنْ قَلْبٍ لَا يَخْشَعُ وَمِنْ نَفْسٍ لَا تَشْبَعُ وَمِنْ دَعْوَةٍ لَا يُسْتَجَابُ لَهَا',
    text_ms: 'Ya Allah, aku berlindung dengan-Mu daripada ilmu yang tidak bermanfaat, hati yang tidak khusyuk, jiwa yang tidak pernah puas, dan doa yang tidak dimakbulkan.',
    text_en: 'O Allah, I seek refuge with You from knowledge that does not benefit, a heart that does not humble itself, a soul that is never satisfied, and a supplication that is not answered.',
    ref: 'Riwayat Muslim'
  },
  {
    arabic: 'رَبِّ ارْحَمْهُمَا كَمَا رَبَّيَانِي صَغِيرًا',
    text_ms: 'Wahai Tuhanku, kasihilah kedua-duanya sebagaimana mereka mengasihiku semasa kecil.',
    text_en: 'My Lord, have mercy upon them as they brought me up when I was small.',
    ref: 'Al-Isra 17:24'
  },
  {
    arabic: 'رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ',
    text_ms: 'Wahai Tuhan kami, berilah kami kebaikan di dunia dan kebaikan di akhirat, dan peliharalah kami daripada azab neraka.',
    text_en: 'Our Lord, give us good in this world and good in the Hereafter, and protect us from the punishment of the Fire.',
    ref: 'Al-Baqarah 2:201'
  },
  {
    arabic: 'سُبْحَانَ الَّذِي سَخَّرَ لَنَا هَذَا وَمَا كُنَّا لَهُ مُقْرِنِينَ وَإِنَّا إِلَى رَبِّنَا لَمُنْقَلِبُونَ',
    text_ms: 'Maha Suci Allah yang telah memudahkan (kenderaan) ini bagi kami, padahal kami tidak mampu menguasainya; dan sesungguhnya kepada Tuhan kami, kami akan kembali. (doa safar)',
    text_en: 'Glory to Him who has subjected this to us, and we could never have accomplished it by ourselves; indeed to our Lord we are returning. (travel)',
    ref: 'Riwayat Muslim — Az-Zukhruf 43:13-14'
  },
  {
    arabic: 'اللَّهُمَّ إِنَّا نَسْأَلُكَ فِي سَفَرِنَا هَذَا الْبِرَّ وَالتَّقْوَى وَمِنَ الْعَمَلِ مَا تَرْضَى',
    text_ms: 'Ya Allah, kami memohon kepada-Mu dalam perjalanan kami ini kebaikan dan ketaqwaan, serta amalan yang Engkau redai. (doa perjalanan)',
    text_en: 'O Allah, we ask You on this journey of ours righteousness and piety, and deeds that please You. (travel)',
    ref: 'Riwayat Muslim'
  },
  {
    arabic: 'اللَّهُمَّ صَيِّبًا نَافِعًا',
    text_ms: 'Ya Allah, jadikanlah hujan ini hujan yang bermanfaat. (doa ketika hujan)',
    text_en: 'O Allah, may it be a beneficial rain. (when it rains)',
    ref: 'Riwayat Bukhari'
  },
  {
    arabic: 'مُطِرْنَا بِفَضْلِ اللَّهِ وَرَحْمَتِهِ',
    text_ms: 'Kami diberi hujan kerana limpah kurnia dan rahmat Allah. (doa selepas hujan)',
    text_en: 'We have been given rain by the favour and mercy of Allah. (after rain)',
    ref: 'Riwayat Bukhari & Muslim'
  },
  {
    arabic: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ خَيْرَهَا وَخَيْرَ مَا فِيهَا وَخَيْرَ مَا أُرْسِلَتْ بِهِ وَأَعُوذُ بِكَ مِنْ شَرِّهَا وَشَرِّ مَا فِيهَا وَشَرِّ مَا أُرْسِلَتْ بِهِ',
    text_ms: 'Ya Allah, aku memohon kebaikan angin ini, kebaikan yang ada padanya dan kebaikan yang ia diutus dengannya; dan aku berlindung dengan-Mu daripada kejahatannya, kejahatan yang ada padanya dan kejahatan yang ia diutus dengannya. (doa ketika angin kencang)',
    text_en: 'O Allah, I ask You for its good, the good within it, and the good it was sent with; and I seek refuge with You from its evil, the evil within it, and the evil it was sent with. (strong wind)',
    ref: 'Riwayat Muslim'
  },
  {
    arabic: 'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْهَمِّ وَالْحَزَنِ وَالْعَجْزِ وَالْكَسَلِ وَالْبُخْلِ وَالْجُبْنِ وَضَلَعِ الدَّيْنِ وَغَلَبَةِ الرِّجَالِ',
    text_ms: 'Ya Allah, aku berlindung dengan-Mu daripada kebimbangan dan kesedihan, kelemahan dan kemalasan, sifat bakhil dan penakut, bebanan hutang dan penindasan manusia. (doa ketika gelisah)',
    text_en: 'O Allah, I seek refuge with You from anxiety and sorrow, weakness and laziness, miserliness and cowardice, the burden of debt, and being overpowered by others. (distress)',
    ref: 'Riwayat Bukhari'
  },
  {
    arabic: 'لَا إِلَهَ إِلَّا أَنْتَ سُبْحَانَكَ إِنِّي كُنْتُ مِنَ الظَّالِمِينَ',
    text_ms: 'Tiada Tuhan melainkan Engkau, Maha Suci Engkau, sesungguhnya aku adalah daripada orang-orang yang zalim. (doa Nabi Yunus)',
    text_en: 'There is no deity except You; glory be to You; indeed, I have been of the wrongdoers. (dua of Prophet Yunus)',
    ref: 'Al-Anbiya 21:87'
  },
  {
    arabic: 'اللَّهُمَّ اكْفِنِي بِحَلَالِكَ عَنْ حَرَامِكَ وَأَغْنِنِي بِفَضْلِكَ عَمَّنْ سِوَاكَ',
    text_ms: 'Ya Allah, cukupkanlah aku dengan yang halal-Mu sehingga terhindar daripada yang haram, dan kayakanlah aku dengan limpah kurnia-Mu sehingga tidak memerlukan kepada selain-Mu. (doa melapangkan hutang)',
    text_en: 'O Allah, suffice me with what is lawful so I avoid what is unlawful, and enrich me by Your bounty so I have no need of anyone besides You. (debt relief)',
    ref: 'Riwayat Tirmizi'
  },
  {
    arabic: 'أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ',
    text_ms: 'Aku berlindung dengan Allah daripada syaitan yang direjam. (doa ketika marah)',
    text_en: 'I seek refuge with Allah from the accursed devil. (when angry)',
    ref: 'Riwayat Bukhari & Muslim'
  },
  {
    arabic: 'أَسْأَلُ اللَّهَ الْعَظِيمَ رَبَّ الْعَرْشِ الْعَظِيمِ أَنْ يَشْفِيَكَ',
    text_ms: 'Aku memohon kepada Allah yang Maha Agung, Tuhan Arasy yang agung, agar menyembuhkanmu. (doa menziarahi orang sakit)',
    text_en: 'I ask Allah the Mighty, Lord of the Magnificent Throne, to cure you. (visiting the sick)',
    ref: 'Riwayat Abu Dawud & Tirmizi'
  },
  {
    arabic: 'رَبَّنَا لَا تُزِغْ قُلُوبَنَا بَعْدَ إِذْ هَدَيْتَنَا وَهَبْ لَنَا مِنْ لَدُنْكَ رَحْمَةً إِنَّكَ أَنْتَ الْوَهَّابُ',
    text_ms: 'Wahai Tuhan kami, jangan Engkau memesongkan hati kami setelah Engkau memberi petunjuk kepada kami, dan kurniakanlah kami rahmat daripada sisi-Mu; sesungguhnya Engkaulah Maha Pemberi. (penutup bulan)',
    text_en: 'Our Lord, let not our hearts deviate after You have guided us, and grant us mercy from Yourself; indeed, You are the Bestower. (closing of the month)',
    ref: 'Ali Imran 3:8'
  }
];

// Pilih doa mengikut haribulan (deterministik — 1 haribulan = doa #1, dan
// kitaran auto-renew semula pada setiap 1 haribulan bulan baharu).
export function doaForDate(dateKey: string): DailyDoa {
  const [, , d] = dateKey.split('-').map(Number);
  if (!d) return DOAS[0];
  return DOAS[(d - 1) % DOAS.length];
}

// Selesaikan pengumuman kategori 'doa': isi doa harian sebagai lalai,
// kecuali pentadbir beri doa sendiri (override).
export function resolveDoaAnnouncements<T extends Announcement>(
  announcements: T[],
  todayKey: string
): T[] {
  const doa = doaForDate(todayKey);
  return announcements.map((a) => {
    if (a.category !== 'doa') return a;
    return {
      ...a,
      arabic: String(a.arabic || '').trim() || doa.arabic,
      translationMs: String(a.translationMs || '').trim() || doa.text_ms,
      translationEn: String(a.translationEn || '').trim() || doa.text_en,
      ref: String(a.ref || '').trim() || doa.ref
    };
  });
}
