// Ayat Quran Pilihan Harian — senarai ayat pendek yang auto-rotasi setiap hari.
// Pentadbir boleh guna ayat ini terus (kategori "quran" + quranDaily) atau
// mengatasi (override) dengan ayat sendiri melalui medan arabic/translation/ref.
export const VERSES = [
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
    }
];
const DAY_MS = 86400000;
// Pilih ayat untuk tarikh (deterministik — bertukar setiap hari).
export function quranVerseForDate(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    if (!y || !m || !d)
        return VERSES[0];
    const day = Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
    return VERSES[((day % VERSES.length) + VERSES.length) % VERSES.length];
}
// Selesaikan pengumuman kategori 'quran': isi ayat harian sebagai lalai,
// kecuali pentadbir beri ayat sendiri (override).
export function resolveQuranAnnouncements(announcements, todayKey) {
    const verse = quranVerseForDate(todayKey);
    return announcements.map((a) => {
        if (a.category !== 'quran')
            return a;
        return {
            ...a,
            arabic: String(a.arabic || '').trim() || verse.arabic,
            translationMs: String(a.translationMs || '').trim() || verse.text_ms,
            translationEn: String(a.translationEn || '').trim() || verse.text_en,
            ref: String(a.ref || '').trim() || verse.ref
        };
    });
}
//# sourceMappingURL=quran.js.map