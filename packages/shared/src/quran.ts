// Ayat Quran Pilihan Harian — 31 ayat pendek, satu ayat setiap haribulan
// (kitaran bulanan, auto-renew semula pada setiap 1 haribulan).
// Pentadbir boleh guna ayat ini terus (kategori "quran" + quranDaily) atau
// mengatasi (override) dengan ayat sendiri melalui medan arabic/translation/ref.

import type { Announcement } from './types.js';

export interface QuranVerse {
  arabic: string;
  text_ms: string;
  text_en: string;
  ref: string;
}

// Susunan #1-#31, satu ayat setiap haribulan.
export const VERSES: QuranVerse[] = [
  {
    arabic: 'ٱقْرَأْ بِٱسْمِ رَبِّكَ ٱلَّذِى خَلَقَ',
    text_ms: 'Bacalah dengan nama Tuhanmu yang menciptakan.',
    text_en: 'Read in the name of your Lord who created.',
    ref: 'Al-ʿAlaq 96:1'
  },
  {
    arabic: 'إِنَّ ٱلصَّلَوٰةَ تَنْهَىٰ عَنِ ٱلْفَحْشَآءِ وَٱلْمُنكَرِ',
    text_ms: 'Sesungguhnya solat itu mencegah daripada perbuatan keji dan mungkar.',
    text_en: 'Indeed, prayer prohibits immorality and wrongdoing.',
    ref: 'Al-ʿAnkabut 29:45'
  },
  {
    arabic: 'وَٱسْتَعِينُوا۟ بِٱلصَّبْرِ وَٱلصَّلَوٰةِ',
    text_ms: 'Dan mintalah pertolongan dengan sabar dan solat.',
    text_en: 'And seek help through patience and prayer.',
    ref: 'Al-Baqarah 2:45'
  },
  {
    arabic: 'إِنَّ مَعَ ٱلْعُسْرِ يُسْرًا',
    text_ms: 'Sesungguhnya bersama kesulitan itu ada kemudahan.',
    text_en: 'Indeed, with hardship comes ease.',
    ref: 'Ash-Sharh 94:6'
  },
  {
    arabic: 'وَمَن يَتَوَكَّلْ عَلَى ٱللَّهِ فَهُوَ حَسْبُهُۥ',
    text_ms: 'Dan sesiapa yang bertawakal kepada Allah, maka cukuplah Allah baginya.',
    text_en: 'And whoever relies upon Allah — He is sufficient for him.',
    ref: 'At-Talaq 65:3'
  },
  {
    arabic: 'إِنَّ ٱللَّهَ مَعَ ٱلصَّٰبِرِينَ',
    text_ms: 'Sesungguhnya Allah bersama orang-orang yang sabar.',
    text_en: 'Indeed, Allah is with the patient.',
    ref: 'Al-Baqarah 2:153'
  },
  {
    arabic: 'فَٱذْكُرُونِىٓ أَذْكُرْكُمْ',
    text_ms: 'Maka ingatlah kamu kepada-Ku, nescaya Aku ingat kepadamu.',
    text_en: 'So remember Me; I will remember you.',
    ref: 'Al-Baqarah 2:152'
  },
  {
    arabic: 'رَّبِّ زِدْنِى عِلْمًا',
    text_ms: 'Wahai Tuhanku, tambahkanlah ilmuku.',
    text_en: 'My Lord, increase me in knowledge.',
    ref: 'Ṭāhā 20:114'
  },
  {
    arabic: 'وَأَقِمِ ٱلصَّلَوٰةَ لِذِكْرِى',
    text_ms: 'Dan dirikanlah solat untuk mengingati-Ku.',
    text_en: 'And establish prayer for My remembrance.',
    ref: 'Ṭāhā 20:14'
  },
  {
    arabic: 'إِنَّ ٱللَّهَ يُحِبُّ ٱلتَّوَّٰبِينَ وَيُحِبُّ ٱلْمُتَطَهِّرِينَ',
    text_ms: 'Sesungguhnya Allah mengasihi orang-orang yang bertaubat dan mengasihi orang-orang yang bersuci.',
    text_en: 'Indeed, Allah loves those who repent and loves those who purify themselves.',
    ref: 'Al-Baqarah 2:222'
  },
  {
    arabic: 'لَا يُكَلِّفُ ٱللَّهُ نَفْسًا إِلَّا وُسْعَهَا',
    text_ms: 'Allah tidak membebani seseorang melainkan sesuai dengan kesanggupannya.',
    text_en: 'Allah does not burden a soul beyond that it can bear.',
    ref: 'Al-Baqarah 2:286'
  },
  {
    arabic: 'لَا تَقْنَطُوا۟ مِن رَّحْمَةِ ٱللَّهِ',
    text_ms: 'Janganlah kamu berputus asa daripada rahmat Allah.',
    text_en: 'Do not despair of the mercy of Allah.',
    ref: 'Az-Zumar 39:53'
  },
  {
    arabic: 'رَبَّنَا لَا تُزِغْ قُلُوبَنَا بَعْدَ إِذْ هَدَيْتَنَا',
    text_ms: 'Wahai Tuhan kami, jangan Engkau memesongkan hati kami setelah Engkau memberi petunjuk kepada kami.',
    text_en: 'Our Lord, let not our hearts deviate after You have guided us.',
    ref: 'Ali Imran 3:8'
  },
  {
    arabic: 'وَلَا تَهِنُوا۟ وَلَا تَحْزَنُوا۟ وَأَنتُمُ ٱلْأَعْلَوْنَ إِن كُنتُم مُّؤْمِنِينَ',
    text_ms: 'Dan janganlah kamu lemah semangat dan jangan bersedih hati, kerana kamu paling tinggi darjatnya jika kamu orang beriman.',
    text_en: 'So do not weaken and do not grieve, for you will be superior if you are believers.',
    ref: 'Ali Imran 3:139'
  },
  {
    arabic: 'إِنَّ ٱللَّهَ يَأْمُرُ بِٱلْعَدْلِ وَٱلْإِحْسَٰنِ',
    text_ms: 'Sesungguhnya Allah menyuruh berlaku adil dan berbuat kebaikan.',
    text_en: 'Indeed, Allah orders justice and good conduct.',
    ref: 'An-Nahl 16:90'
  },
  {
    arabic: 'رَّبِّ ٱرْحَمْهُمَا كَمَا رَبَّيَانِى صَغِيرًا',
    text_ms: 'Wahai Tuhanku, kasihilah kedua-duanya sebagaimana mereka mengasihiku semasa kecil.',
    text_en: 'My Lord, have mercy upon them as they brought me up when I was small.',
    ref: 'Al-Isra 17:24'
  },
  {
    arabic: 'ٱلْمَالُ وَٱلْبَنُونَ زِينَةُ ٱلْحَيَوٰةِ ٱلدُّنْيَا ۖ وَٱلْبَٰقِيَٰتُ ٱلصَّٰلِحَٰتُ خَيْرٌ عِندَ رَبِّكَ ثَوَابًا',
    text_ms: 'Harta dan anak-anak adalah perhiasan kehidupan dunia; amal-amal soleh yang kekal lebih baik di sisi Tuhanmu sebagai balasan.',
    text_en: 'Wealth and children are the adornment of worldly life, but the enduring good deeds are better with your Lord for reward.',
    ref: 'Al-Kahf 18:46'
  },
  {
    arabic: 'وَأَقِمِ ٱلصَّلَوٰةَ طَرَفَىِ ٱلنَّهَارِ وَزُلَفًا مِّنَ ٱلَّيْلِ ۚ إِنَّ ٱلْحَسَنَٰتِ يُذْهِبْنَ ٱلسَّيِّـَٔاتِ',
    text_ms: 'Dan dirikanlah solat pada dua bahagian siang dan pada waktu yang dekat dengan malam; sesungguhnya kebaikan itu menghapuskan kejahatan.',
    text_en: 'And establish prayer at the two ends of the day and at the approach of the night; indeed, good deeds do away with misdeeds.',
    ref: 'Hud 11:114'
  },
  {
    arabic: 'أَلَا بِذِكْرِ ٱللَّهِ تَطْمَئِنُّ ٱلْقُلُوبُ',
    text_ms: 'Ketahuilah, hanya dengan mengingati Allah hati menjadi tenteram.',
    text_en: 'Verily, in the remembrance of Allah do hearts find rest.',
    ref: 'Ar-Raʿd 13:28'
  },
  {
    arabic: 'لَئِن شَكَرْتُمْ لَأَزِيدَنَّكُمْ',
    text_ms: 'Demi sesungguhnya, jika kamu bersyukur, nescaya Aku tambah nikmat-Ku kepada kamu.',
    text_en: 'If you are grateful, I will surely increase you.',
    ref: 'Ibrahim 14:7'
  },
  {
    arabic: 'قُلْ إِنَّ صَلَاتِى وَنُسُكِى وَمَحْيَاىَ وَمَمَاتِى لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ',
    text_ms: 'Katakanlah: sesungguhnya solatku, ibadahku, hidupku dan matiku hanyalah untuk Allah, Tuhan sekalian alam.',
    text_en: 'Say: indeed, my prayer, my rites of sacrifice, my living and my dying are for Allah, Lord of the worlds.',
    ref: 'Al-Anʿam 6:162'
  },
  {
    arabic: 'وَقَالَ رَبُّكُمُ ٱدْعُونِىٓ أَسْتَجِبْ لَكُمْ',
    text_ms: 'Dan Tuhan kamu berfirman: berdoalah kamu kepada-Ku, nescaya Aku perkenankan permintaan kamu.',
    text_en: 'And your Lord says: call upon Me; I will respond to you.',
    ref: 'Ghafir 40:60'
  },
  {
    arabic: 'رَبَّنَا هَبْ لَنَا مِنْ أَزْوَٰجِنَا وَذُرِّيَّٰتِنَا قُرَّةَ أَعْيُنٍ وَٱجْعَلْنَا لِلْمُتَّقِينَ إِمَامًا',
    text_ms: 'Wahai Tuhan kami, berilah kami daripada pasangan dan keturunan kami penyejuk mata, dan jadikanlah kami pemimpin bagi orang-orang yang bertakwa.',
    text_en: 'Our Lord, grant us from among our spouses and offspring comfort to our eyes, and make us leaders of the righteous.',
    ref: 'Al-Furqan 25:74'
  },
  {
    arabic: 'فَاعْفُ عَنْهُمْ وَٱسْتَغْفِرْ لَهُمْ وَشَاوِرْهُمْ فِى ٱلْأَمْرِ',
    text_ms: 'Maka maafkanlah mereka dan mintakan ampun untuk mereka, dan bermusyawarahlah dengan mereka dalam urusan itu.',
    text_en: 'So pardon them and ask forgiveness for them and consult them in the matter.',
    ref: 'Ali Imran 3:159'
  },
  {
    arabic: 'إِنَّ ٱللَّهَ يَأْمُرُكُمْ أَن تُؤَدُّوا۟ ٱلْأَمَٰنَٰتِ إِلَىٰٓ أَهْلِهَا',
    text_ms: 'Sesungguhnya Allah menyuruh kamu menyampaikan amanah kepada orang yang berhak menerimanya.',
    text_en: 'Indeed, Allah commands you to render trusts to whom they are due.',
    ref: 'An-Nisa 4:58'
  },
  {
    arabic: 'وَتَعَاوَنُوا۟ عَلَى ٱلْبِرِّ وَٱلتَّقْوَىٰ ۖ وَلَا تَعَاوَنُوا۟ عَلَى ٱلْإِثْمِ وَٱلْعُدْوَٰنِ',
    text_ms: 'Dan tolong-menolonglah kamu dalam kebaikan dan ketaqwaan, dan jangan tolong-menolong dalam dosa dan permusuhan.',
    text_en: 'And cooperate in righteousness and piety, but do not cooperate in sin and aggression.',
    ref: 'Al-Maʾidah 5:2'
  },
  {
    arabic: 'وَٱعْتَصِمُوا۟ بِحَبْلِ ٱللَّهِ جَمِيعًا وَلَا تَفَرَّقُوا۟',
    text_ms: 'Dan berpegang teguhlah kamu pada tali (agama) Allah bersama-sama, dan janganlah kamu berpecah-belah.',
    text_en: 'And hold firmly to the rope of Allah all together and do not become divided.',
    ref: 'Ali Imran 3:103'
  },
  {
    arabic: 'يَٰٓأَيُّهَا ٱلنَّاسُ إِنَّا خَلَقْنَٰكُم مِّن ذَكَرٍ وَأُنثَىٰ وَجَعَلْنَٰكُمْ شُعُوبًا وَقَبَآئِلَ لِتَعَارَفُوا۟',
    text_ms: 'Wahai manusia, sesungguhnya Kami menciptakan kamu daripada lelaki dan perempuan, dan menjadikan kamu berbagai bangsa dan suku untuk saling berkenalan.',
    text_en: 'O mankind, indeed We created you from male and female and made you peoples and tribes that you may know one another.',
    ref: 'Al-Hujurat 49:13'
  },
  {
    arabic: 'يَٰبُنَىَّ أَقِمِ ٱلصَّلَوٰةَ وَٱمُرْ بِٱلْمَعْرُوفِ وَٱنْهَ عَنِ ٱلْمُنكَرِ وَٱصْبِرْ عَلَىٰ مَآ أَصَابَكَ',
    text_ms: 'Wahai anakku, dirikanlah solat dan suruhlah berbuat baik serta laranglah daripada perbuatan mungkar, dan sabarlah terhadap apa yang menimpamu.',
    text_en: 'O my son, establish prayer, enjoin what is right, forbid what is wrong, and be patient over what befalls you.',
    ref: 'Luqman 31:17'
  },
  {
    arabic: 'ٱدْفَعْ بِٱلَّتِى هِىَ أَحْسَنُ فَإِذَا ٱلَّذِى بَيْنَكَ وَبَيْنَهُۥ عَدَٰوَةٌ كَأَنَّهُۥ وَلِىٌّ حَمِيمٌ',
    text_ms: 'Tolaklah (kejahatan itu) dengan cara yang lebih baik, maka tiba-tiba orang yang ada permusuhan antara kamu dengannya menjadi seperti sahabat karib.',
    text_en: 'Repel evil with that which is better; and suddenly the one between whom and you was enmity will become as though a devoted friend.',
    ref: 'Fussilat 41:34'
  },
  {
    arabic: 'رَبَّنَآ ءَاتِنَا فِى ٱلدُّنْيَا حَسَنَةً وَفِى ٱلْأَخِرَةِ حَسَنَةً وَقِنَا عَذَابَ ٱلنَّارِ',
    text_ms: 'Wahai Tuhan kami, berilah kami kebaikan di dunia dan kebaikan di akhirat, dan peliharalah kami daripada azab neraka.',
    text_en: 'Our Lord, give us good in this world and good in the Hereafter, and protect us from the punishment of the Fire.',
    ref: 'Al-Baqarah 2:201'
  }
];

// Pilih ayat mengikut haribulan (deterministik — 1 haribulan = ayat #1, dan
// kitaran auto-renew semula pada setiap 1 haribulan bulan baharu).
export function quranVerseForDate(dateKey: string): QuranVerse {
  const [, , d] = dateKey.split('-').map(Number);
  if (!d) return VERSES[0];
  return VERSES[(d - 1) % VERSES.length];
}

// Selesaikan pengumuman kategori 'quran': isi ayat harian sebagai lalai,
// kecuali pentadbir beri ayat sendiri (override).
export function resolveQuranAnnouncements<T extends Announcement>(
  announcements: T[],
  todayKey: string
): T[] {
  const verse = quranVerseForDate(todayKey);
  return announcements.map((a) => {
    if (a.category !== 'quran') return a;
    return {
      ...a,
      arabic: String(a.arabic || '').trim() || verse.arabic,
      translationMs: String(a.translationMs || '').trim() || verse.text_ms,
      translationEn: String(a.translationEn || '').trim() || verse.text_en,
      ref: String(a.ref || '').trim() || verse.ref
    };
  });
}
