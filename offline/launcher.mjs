import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModelMetadata, prepareModels } from './models.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const windows = process.platform === 'win32';
const ollama = path.join(root, 'bin', 'ollama', windows ? 'ollama.exe' : 'ollama');
const whisper = path.join(root, 'bin', 'whisper', windows ? 'whisper-cli.exe' : 'whisper-cli');
const ffmpeg = path.join(root, 'bin', windows ? 'ffmpeg.exe' : 'ffmpeg');
const appEntry = path.join(root, 'dist', 'server', 'index.js');
const ollamaPort = 11435;
const appPort = Number(process.env.OFFLINE_PORT ?? 3200);
if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65535) throw new Error('Некорректный OFFLINE_PORT.');
const ollamaUrl = `http://127.0.0.1:${ollamaPort}`;
const appUrl = `http://127.0.0.1:${appPort}`;

async function requireFreePort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Порт ${port} занят. Закройте другое приложение и запустите снова.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

async function waitFor(url, check, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Локальный процесс завершился до запуска.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok && await check(response)) return;
    } catch { /* процесс ещё запускается */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Превышено время ожидания ${url}.`);
}

function openBrowser(url) {
  const command = windows ? 'cmd' : 'open';
  const args = windows ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.log(`Откройте браузер: ${url}`));
}

async function main() {
  await requireFreePort(ollamaPort);
  await requireFreePort(appPort);
  for (const file of [ollama, whisper, ffmpeg, appEntry]) await access(file);
  const metadata = await loadModelMetadata(root);
  console.log('Проверяем локальные модели. При первом запуске это может занять несколько минут…');
  const { whisperFile, storeDir } = await prepareModels(root, metadata);

  const ollamaEnv = {
    ...process.env,
    OLLAMA_HOST: `127.0.0.1:${ollamaPort}`,
    OLLAMA_MODELS: storeDir,
    OLLAMA_NO_CLOUD: '1',
  };
  const ollamaProcess = spawn(ollama, ['serve'], { cwd: root, env: ollamaEnv, stdio: 'inherit' });
  const stop = () => {
    appProcess?.kill();
    ollamaProcess.kill();
  };
  let appProcess;
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await waitFor(`${ollamaUrl}/api/tags`, async (response) => {
      const data = await response.json();
      return data.models?.some((model) => model.name === metadata.ollama.model);
    }, ollamaProcess, 30000);
    const appEnv = {
      ...process.env,
      APP_MODE: 'live',
      HOST: '127.0.0.1',
      PORT: String(appPort),
      STT_PROVIDER: 'whisper',
      WHISPER_BINARY: whisper,
      WHISPER_MODEL_PATH: whisperFile,
      FFMPEG_BINARY: ffmpeg,
      STT_LANGUAGE: 'ru',
      LLM_PROVIDER: 'ollama',
      LLM_MODEL: metadata.ollama.model,
      OLLAMA_URL: `${ollamaUrl}/api/chat`,
      PROVIDER_TIMEOUT_MS: '120000',
      ...(!windows ? { DYLD_LIBRARY_PATH: path.join(root, 'bin', 'whisper') } : {}),
    };
    appProcess = spawn(process.execPath, [appEntry], { cwd: root, env: appEnv, stdio: 'inherit' });
    await waitFor(`${appUrl}/api/config`, async (response) => {
      const data = await response.json();
      return data.mode === 'live' && data.live?.sttConfigured && data.live?.llmConfigured;
    }, appProcess, 30000);
    console.log(`Готово. Откройте ${appUrl} — интернет не требуется.`);
    openBrowser(appUrl);
    await new Promise((resolve) => appProcess.once('exit', resolve));
  } finally {
    stop();
  }
}

main().catch(async (error) => {
  console.error(`Не удалось запустить приложение: ${error.message}`);
  try { console.error((await readFile(path.join(root, 'README-OFFLINE.txt'), 'utf8')).slice(0, 800)); } catch { /* инструкции отсутствуют */ }
  process.exitCode = 1;
});
