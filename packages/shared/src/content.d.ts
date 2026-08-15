export interface BuiltinContentItem {
    type: 'quran' | 'hadith';
    arabic?: string;
    text_ms: string;
    text_en: string;
    ref: string;
}
declare const content: BuiltinContentItem[];
export default content;
