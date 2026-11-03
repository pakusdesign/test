/** Real local STT smoke test. No Anthropic/Deepgram keys are needed. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { loadDotEnv, loadServerConfig } from '../../src/server/config';
import { createProviders } from '../../src/server/providers';
import { createApp } from '../../src/server/app';

loadDotEnv(process.cwd());
const config = loadServerConfig({ ...process.env, APP_MODE: 'live', STT_PROVIDER: 'whisper' });
const app = createApp({ config, providers: createProviders(config) });
const results = [];
for (const file of ['quiet-q1.webm', 'quiet-q2.webm', 'names-q4.webm', 'local-russian.webm', 'silence.webm']) {
  const started = Date.now();
  const res = await request(app).post('/api/transcribe')
    .field('requestId', 'whisper-evaluation').field('sessionRevision', '0').field('answerId', 'a1')
    .attach('audio', await readFile(path.join('tests/evals/audio', file)), { filename: file, contentType: 'audio/webm' });
  const pass = file === 'silence.webm' ? res.body.error?.code === 'NO_SPEECH' : res.status === 200 && res.body.text?.trim().length > 0 && res.body.source === 'provider';
  const qualityPassed = file === 'local-russian.webm' ? ['отказов', 'конверсии', 'модул'].every(word => res.body.text?.toLowerCase().includes(word)) : null;
  results.push({ qualityPassed, file, status: res.status, durationMs: Date.now()-started, pass, response: res.body });
  console.log(JSON.stringify(results.at(-1)));
}
const dir = 'docs/evidence/whisper';
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'eval.json'), JSON.stringify({ date: new Date().toISOString(), model: config.sttModel, syntheticAudio: true, results }, null, 2));
if (results.some(r => !r.pass || r.qualityPassed === false)) process.exitCode = 1;
