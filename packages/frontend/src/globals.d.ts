// Deklarasi ambient dikongsi oleh semua skrip frontend (satu skrip per
// halaman pada runtime, tetapi TypeScript lihat kesemuanya dalam satu program).

export {};

declare global {
  interface AndroidBridge {
    setStreamSlot(l: number, t: number, w: number, h: number): void;
    playStream(url: string, name: string, id: string): void;
    stopStream(id: string): void;
    setStreamMuted(muted: boolean): void;
    onSessionExpired(): void;
  }

  interface Window {
    AndroidBridge?: AndroidBridge;
    TVM_IDLE_MS?: number;
  }
}
