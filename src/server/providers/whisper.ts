/** Local whisper.cpp. Temporary audio is private and removed after success/error/cancel. */
import { spawn } from 'node:child_process';
import { constants, accessSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LIMITS } from '../../shared/constants';
import { AppError } from '../errors';
import type { Transcriber, TranscribeInput, TranscribeResult } from './types';

export interface WhisperOptions {
  binary: string;
  ffmpeg: string;
  modelPath: string;
  language: string;
}

export function whisperConfigured(options: WhisperOptions): boolean {
  try {
    for (const file of [options.binary, options.ffmpeg]) {
      if (!path.isAbsolute(file)) return false;
      accessSync(file, constants.X_OK);
    }
    if (!path.isAbsolute(options.modelPath)) return false;
    accessSync(options.modelPath, constants.R_OK);
    return true;
  } catch { return false; }
}

/** No shell. Wait for close before deleting files; cancellation also kills native inference. */
export function runLocalProcess(binary: string, args: string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const child = spawn(binary, args, { stdio: 'ignore' });
    const abort = () => { child.kill('SIGKILL'); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.once('error', () => {
      signal.removeEventListener('abort', abort);
      reject(new AppError('CONFIGURATION_ERROR'));
    });
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(signal.reason);
      else if (code !== 0) reject(new AppError('PROVIDER_ERROR'));
      else resolve();
    });
  });
}

/** ffmpeg generates mono 16-bit PCM WAV. Reject digital silence before Whisper can hallucinate. */
export function hasAudioEnergy(wav: Buffer): boolean {
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    if (wav.toString('ascii', offset, offset + 4) === 'data') {
      const end = Math.min(wav.length, offset + 8 + size);
      let sum = 0, count = 0;
      for (let i = offset + 8; i + 1 < end; i += 2) { const v = wav.readInt16LE(i) / 32768; sum += v * v; count++; }
      return count > 0 && Math.sqrt(sum / count) > 0.0001;
    }
    offset += 8 + size + (size % 2);
  }
  return false;
}

export class WhisperTranscriber implements Transcriber {
  readonly source = 'provider' as const;
  private busy = false;
  constructor(private readonly options: WhisperOptions) {}
  get model(): string { return `whisper.cpp/${path.basename(this.options.modelPath)}`; }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    if (!input.audio?.length) throw new AppError('NO_SPEECH');
    if (!whisperConfigured(this.options)) throw new AppError('CONFIGURATION_ERROR');
    if (this.busy) throw new AppError('RATE_LIMITED', { retryAfterSeconds: 2 });
    this.busy = true;
    let dir: string | undefined;
    try {
      input.signal.throwIfAborted();
      dir = await mkdtemp(path.join(tmpdir(), 'vacancy-whisper-'));
      const source = path.join(dir, 'input');
      const wav = path.join(dir, 'audio.wav');
      const output = path.join(dir, 'transcript');
      await writeFile(source, input.audio, { mode: 0o600 });
      try {
        await runLocalProcess(this.options.ffmpeg, ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', source, '-t', String(LIMITS.maxRecordingSeconds), '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-y', wav], input.signal);
      } catch (error) {
        if (input.signal.aborted || (error instanceof AppError && error.code === 'CONFIGURATION_ERROR')) throw error;
        throw new AppError('UNSUPPORTED_AUDIO');
      }
      if (!hasAudioEnergy(await readFile(wav))) throw new AppError('NO_SPEECH');
      await runLocalProcess(this.options.binary, ['-m', this.options.modelPath, '-f', wav, '-l', this.options.language, '-otxt', '-of', output, '-nt', '-np'], input.signal);
      const text = (await readFile(`${output}.txt`, 'utf8')).trim();
      if (!text) throw new AppError('NO_SPEECH');
      return { text, language: this.options.language };
    } finally {
      try { if (dir) await rm(dir, { recursive: true, force: true }); }
      finally { this.busy = false; }
    }
  }
}
