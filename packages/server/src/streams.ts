// Pengurusan relay live stream: RTSP / RTMP / ONVIF -> HLS melalui ffmpeg.
// Output HLS disimpan di dataDir/relay/<id>/ dan dipaparkan oleh hls.js.
// Port of reference server/streams.js.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isRelayType } from '@masjidtv/shared';
import type { Stream } from '@masjidtv/shared';

export { isRelayType };

interface RelayEntry {
  proc: ReturnType<typeof spawn> | null;
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: number;
  /** Ditandakan true oleh stopRelay — halang exit handler menjadualkan semula. */
  stopped?: boolean;
}

export class StreamManager {
  private procs = new Map<string, RelayEntry>();
  private restartTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; count: number }>();
  private ffmpegOk: boolean | null = null;
  private ffmpegCheck: Promise<boolean> | null = null;
  private closed = false;

  constructor(
    private dataDir: string,
    private getStreams: () => Stream[],
    private getFfmpegPath: () => string
  ) {}

  private relayDir(id: string): string {
    return path.join(this.dataDir, 'relay', id);
  }

  async checkFfmpeg(): Promise<boolean> {
    if (this.ffmpegOk !== null) return this.ffmpegOk;
    // Coalesce semakan serentak (startup checkFfmpeg berlumba PUT /streams).
    if (this.ffmpegCheck) return this.ffmpegCheck;
    const fp = this.getFfmpegPath() || 'ffmpeg';
    this.ffmpegCheck = new Promise<boolean>((resolve) => {
      const p = spawn(fp, ['-version'], { windowsHide: true, stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.on('exit', (code) => resolve(code === 0));
    }).then((ok) => {
      this.ffmpegOk = ok;
      this.ffmpegCheck = null;
      return ok;
    });
    return this.ffmpegCheck;
  }

  resetFfmpegCheck(): void {
    this.ffmpegOk = null;
  }

  private clearRestartTimer(id: string): void {
    const t = this.restartTimers.get(id);
    if (t) {
      clearTimeout(t.timer);
      this.restartTimers.delete(id);
    }
  }

  private startRelay(stream: Stream): void {
    if (this.procs.has(stream.id)) return;
    if (this.ffmpegOk === false) return;
    const outDir = this.relayDir(stream.id);
    fs.mkdirSync(outDir, { recursive: true });
    try {
      for (const f of fs.readdirSync(outDir)) {
        if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
          fs.unlinkSync(path.join(outDir, f));
        }
      }
    } catch {
      /* ignore */
    }

    const fp = this.getFfmpegPath() || 'ffmpeg';
    const args: string[] = [];
    if (stream.type === 'rtsp' || stream.type === 'onvif') {
      args.push('-rtsp_transport', 'tcp');
    }
    if (['rtsp', 'rtmp', 'onvif', 'hls'].includes(stream.type)) {
      args.push('-rw_timeout', '10000000');
    }
    args.push(
      '-loglevel', 'error',
      '-nostats',
      '-i', stream.url,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-g', '50',
      '-sc_threshold', '0',
      '-c:a', 'aac',
      '-b:a', '64k',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '6',
      '-hls_flags', 'delete_segments+append_list',
      '-hls_segment_filename', path.join(outDir, 'seg_%05d.ts'),
      path.join(outDir, 'index.m3u8')
    );

    const entry: RelayEntry = { proc: null, status: 'starting', startedAt: Date.now() };
    this.procs.set(stream.id, entry);

    // stdio ignore: ffmpeg menulis log statistik berterusan ke stderr; paip
    // yang tidak dibaca akan penuh (~64KB) dan ffmpeg tersekat menulis —
    // relay membeku tanpa keluar. Matikan log melalui flag + jangan paip.
    const proc = spawn(fp, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    entry.proc = proc;
    // Jangan biarkan paip stderr mengumpul — longgarkan walaupun -loglevel error.
    proc.stderr?.on('data', () => {});
    proc.on('error', () => {
      entry.status = 'error';
      this.procs.delete(stream.id);
      if (!entry.stopped) this.scheduleRestart(stream);
    });
    proc.on('exit', () => {
      entry.status = 'stopped';
      this.procs.delete(stream.id);
      if (!entry.stopped) this.scheduleRestart(stream);
    });

    const statusTimer = setTimeout(() => {
      const cur = this.procs.get(stream.id);
      if (cur === entry && entry.status === 'starting') entry.status = 'running';
    }, 5000);
    statusTimer.unref?.();
  }

  private scheduleRestart(stream: Stream): void {
    this.clearRestartTimer(stream.id);
    // Selepas stopAll()/shutdown, JANGAN jadualkan semula — jika tidak,
    // pemasa akan menyalakan ffmpeg baharu selepas pelayan ditutup.
    if (this.closed || this.ffmpegOk === false) return;
    const count = (this.restartTimers.get(stream.id)?.count || 0) + 1;
    const delay = Math.min(60000, 5000 * Math.pow(2, Math.min(count, 4)));
    const timer = setTimeout(() => {
      this.restartTimers.delete(stream.id);
      const s = this.getStreams().find((x) => x.id === stream.id);
      if (s && s.enabled && isRelayType(s.type)) this.startRelay(s);
    }, delay);
    timer.unref?.();
    this.restartTimers.set(stream.id, { timer, count });
  }

  stopRelay(id: string): void {
    this.clearRestartTimer(id);
    const entry = this.procs.get(id);
    if (entry) {
      entry.stopped = true; // halang exit-handler menyalakan semula
      if (entry.proc) {
        try {
          entry.proc.kill();
        } catch {
          /* already dead */
        }
      }
      this.procs.delete(id);
    }
  }

  // Hentikan SEMUA relay + pemasa mula semula — dipanggil onClose supaya
  // tiada proses ffmpeg yatim selepas pelayan ditutup/dimulakan semula.
  stopAll(): void {
    this.closed = true;
    for (const id of [...this.restartTimers.keys()]) {
      this.clearRestartTimer(id);
    }
    for (const id of [...this.procs.keys()]) {
      this.stopRelay(id);
    }
  }

  async sync(): Promise<void> {
    if (this.ffmpegOk === null) await this.checkFfmpeg();
    if (this.closed) return;
    const streams = this.getStreams();
    const wanted = new Set(streams.filter((s) => s.enabled && isRelayType(s.type)).map((s) => s.id));
    for (const id of [...this.procs.keys()]) {
      if (!wanted.has(id)) this.stopRelay(id);
    }
    for (const s of streams) {
      if (s.enabled && isRelayType(s.type)) this.startRelay(s);
    }
  }

  streamStatus(stream: Stream): Record<string, unknown> {
    const base: Record<string, unknown> = {
      id: stream.id,
      name: stream.name,
      type: stream.type,
      url: stream.url,
      duration: stream.duration,
      enabled: stream.enabled
    };
    if (!isRelayType(stream.type)) {
      base.status = 'configured';
      base.hlsUrl = null;
      return base;
    }
    base.hlsUrl = `/relay/${stream.id}/index.m3u8`;
    if (!stream.enabled) {
      base.status = 'disabled';
      return base;
    }
    if (this.ffmpegOk === false) {
      base.status = 'ffmpeg-missing';
      return base;
    }
    const entry = this.procs.get(stream.id);
    base.status = entry ? entry.status : 'stopped';
    return base;
  }

  allStatus(): Record<string, unknown>[] {
    return this.getStreams().map((s) => this.streamStatus(s));
  }
}
