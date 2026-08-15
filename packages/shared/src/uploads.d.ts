export interface UploadTypeDef {
    ext: string;
    kind: 'image' | 'video' | 'audio';
    magic: (b: Buffer) => boolean;
}
export declare const UPLOAD_TYPES: Record<string, UploadTypeDef>;
export declare const UPLOAD_CONTENT_TYPES: string[];
