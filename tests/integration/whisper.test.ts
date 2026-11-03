import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WhisperTranscriber, runLocalProcess, whisperConfigured } from '../../src/server/providers/whisper';
import { loadServerConfig } from '../../src/server/config';
import { createProviders, liveReadiness } from '../../src/server/providers';
import { callWithBudget, createBudget } from '../../src/server/budget';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const input = () => ({ audio: Buffer.from('audio'), mimeType: 'audio/webm', signal: new AbortController().signal });
async function setup(text: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'whisper-test-')); dirs.push(dir);
  const modelPath = path.join(dir, 'model'); await writeFile(modelPath, 'model');
  const converter = path.join(dir, 'converter');
  await writeFile(converter, `#!${process.execPath}\nconst fs=require('fs');const b=Buffer.alloc(48);b.write('data',12);b.writeUInt32LE(28,16);b.writeInt16LE(2000,20);fs.writeFileSync(process.argv.at(-1),b);`, { mode: 0o700 });
  const binary = path.join(dir, 'whisper');
  await writeFile(binary, `#!${process.execPath}\nrequire('fs').writeFileSync(process.argv[process.argv.indexOf('-of')+1]+'.txt',${JSON.stringify(text)});`, { mode: 0o700 });
  return { binary, ffmpeg: converter, modelPath, language: 'ru' };
}

describe('local whisper.cpp', () => {
  it('defaults to whisper; missing local files do not fall back to fixtures or cloud', async () => {
    const cfg = loadServerConfig({ APP_MODE: 'live' });
    expect(cfg.sttProvider).toBe('whisper');
    expect(liveReadiness(cfg).sttConfigured).toBe(false);
    await expect(createProviders(cfg).transcriber.transcribe(input())).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(() => loadServerConfig({ STT_PROVIDER: 'unknown' })).toThrow();
  });
  it('returns native output and provider provenance without any API key', async () => {
    const options = await setup(' Проверяет счета. ');
    expect(whisperConfigured(options)).toBe(true);
    const t = new WhisperTranscriber(options);
    expect(t.source).toBe('provider');
    await expect(t.transcribe(input())).resolves.toEqual({ text: 'Проверяет счета.', language: 'ru' });
  });
  it('rejects empty audio and empty transcription', async () => {
    const t = new WhisperTranscriber(await setup(''));
    await expect(t.transcribe({ ...input(), audio: Buffer.alloc(0) })).rejects.toMatchObject({ code: 'NO_SPEECH' });
    await expect(t.transcribe(input())).rejects.toMatchObject({ code: 'NO_SPEECH' });
  });
  it('maps decoding errors and allows subsequent requests after failure', async () => {
    const o = await setup('text');
    await writeFile(o.ffmpeg, `#!${process.execPath}\nprocess.exit(1);`, { mode: 0o700 });
    const t = new WhisperTranscriber(o);
    for (let i=0;i<2;i++) await expect(t.transcribe(input())).rejects.toMatchObject({ code: 'UNSUPPORTED_AUDIO' });
  });
  it('kills the child process when the operation budget expires', async () => {
    const start=Date.now();
    await expect(callWithBudget(createBudget(100, new AbortController().signal), signal => runLocalProcess(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], signal))).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(Date.now()-start).toBeLessThan(3000);
  });
});
