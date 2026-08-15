import type { Settings, StreamType } from './types.js';
export declare function isSafeStreamUrl(url: unknown, type: StreamType): boolean;
type AnyPatch = Record<string, any>;
export declare function applyPatch(current: Settings, patch: AnyPatch): Settings;
export declare const DEFAULT_SETTINGS: Settings;
export {};
