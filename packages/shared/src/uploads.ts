// Shared upload type map — single source of truth for local server and cloud
// (port of the duplicated UPLOAD_TYPES in both reference apps).

export interface UploadTypeDef {
  ext: string;
  kind: 'image' | 'video' | 'audio';
  magic: (b: Buffer) => boolean;
}

export const UPLOAD_TYPES: Record<string, UploadTypeDef> = {
  'image/png': { ext: 'png', kind: 'image', magic: (b) => b.slice(0, 4).toString('hex').startsWith('89504e47') },
  'image/jpeg': { ext: 'jpg', kind: 'image', magic: (b) => b.slice(0, 2).toString('hex') === 'ffd8' },
  'image/webp': { ext: 'webp', kind: 'image', magic: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' },
  'image/gif': { ext: 'gif', kind: 'image', magic: (b) => b.slice(0, 4).toString('hex') === '47494638' },
  'video/mp4': { ext: 'mp4', kind: 'video', magic: (b) => b.slice(4, 8).toString('ascii') === 'ftyp' },
  'video/quicktime': { ext: 'mov', kind: 'video', magic: (b) => b.slice(4, 8).toString('ascii') === 'ftyp' },
  'video/x-m4v': { ext: 'm4v', kind: 'video', magic: (b) => b.slice(4, 8).toString('ascii') === 'ftyp' },
  'video/3gpp': { ext: '3gp', kind: 'video', magic: (b) => b.slice(4, 8).toString('ascii') === 'ftyp' },
  'video/3gpp2': { ext: '3g2', kind: 'video', magic: (b) => b.slice(4, 8).toString('ascii') === 'ftyp' },
  'video/webm': { ext: 'webm', kind: 'video', magic: (b) => b.slice(0, 4).toString('hex') === '1a45dfa3' },
  'video/ogg': { ext: 'ogv', kind: 'video', magic: (b) => b.slice(0, 4).toString('ascii') === 'OggS' },
  'video/x-matroska': { ext: 'mkv', kind: 'video', magic: (b) => b.slice(0, 4).toString('hex') === '1a45dfa3' },
  'video/x-msvideo': { ext: 'avi', kind: 'video', magic: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'AVI ' },
  'video/avi': { ext: 'avi', kind: 'video', magic: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'AVI ' },
  'video/mpeg': { ext: 'mpg', kind: 'video', magic: (b) => ['000001ba', '000001b3'].includes(b.slice(0, 4).toString('hex')) },
  'video/mp2t': { ext: 'ts', kind: 'video', magic: (b) => b[0] === 0x47 && b[188] === 0x47 },
  'video/x-flv': { ext: 'flv', kind: 'video', magic: (b) => b.slice(0, 3).toString('ascii') === 'FLV' },
  'audio/mpeg': { ext: 'mp3', kind: 'audio', magic: (b) => b.length > 2 && (b.slice(0, 3).toString('ascii') === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) },
  'audio/wav': { ext: 'wav', kind: 'audio', magic: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WAVE' },
  'audio/ogg': { ext: 'ogg', kind: 'audio', magic: (b) => b.slice(0, 4).toString('ascii') === 'OggS' },
  'audio/mp4': { ext: 'm4a', kind: 'audio', magic: (b) => b.slice(4, 8).toString('ascii') === 'ftyp' },
  'audio/aac': { ext: 'aac', kind: 'audio', magic: (b) => b.length > 2 && (b[0] === 0xff && (b[1] & 0xf0) === 0xf0) },
  'audio/x-m4a': { ext: 'm4a', kind: 'audio', magic: (b) => b.slice(4, 8).toString('ascii') === 'ftyp' }
};

export const UPLOAD_CONTENT_TYPES = Object.keys(UPLOAD_TYPES);
