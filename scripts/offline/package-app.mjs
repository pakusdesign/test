import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const out = process.env.OUT_DIR;
const prodModules = process.env.PROD_MODULES;
const whisperDir = process.env.WHISPER_DIR;
const ffmpeg = process.env.FFMPEG_BINARY;
const node = process.env.NODE_BINARY;
const modelMeta = process.env.MODEL_META;
const ollamaDir = process.env.OLLAMA_DIR;
if (!out || !prodModules || !whisperDir || !ffmpeg || !node || !modelMeta) {
  throw new Error('Нужны OUT_DIR, PROD_MODULES, WHISPER_DIR, FFMPEG_BINARY, NODE_BINARY и MODEL_META.');
}
const windows = process.platform === 'win32';
const root = process.cwd();
await mkdir(path.join(out, 'bin'), { recursive: true });
for (const item of ['dist', 'prompts']) await cp(path.join(root, item), path.join(out, item), { recursive: true });
await mkdir(path.join(out, 'docs'), { recursive: true });
await cp(path.join(root, 'docs', '03-semantics.md'), path.join(out, 'docs', '03-semantics.md'));
await cp(path.join(root, 'offline', 'launcher.mjs'), path.join(out, 'launcher.mjs'));
await cp(path.join(root, 'offline', 'models.mjs'), path.join(out, 'models.mjs'));
await cp(path.join(root, 'package.json'), path.join(out, 'package.json'));
await cp(path.join(prodModules, 'node_modules'), path.join(out, 'node_modules'), { recursive: true });
await cp(whisperDir, path.join(out, 'bin', 'whisper'), { recursive: true, dereference: true });
await cp(ffmpeg, path.join(out, 'bin', windows ? 'ffmpeg.exe' : 'ffmpeg'));
await cp(node, path.join(out, 'bin', windows ? 'node.exe' : 'node'));
await cp(modelMeta, path.join(out, 'offline-model.json'));
if (ollamaDir) await cp(ollamaDir, path.join(out, 'bin', 'ollama'), { recursive: true, dereference: true });
await mkdir(path.join(out, 'model-assets'), { recursive: true });

const readme = `Голосовой бриф вакансии — автономная версия\n\n1. Скачайте все файлы выпуска для вашей системы и файлы моделей.\n2. Распакуйте архив приложения. Положите ggml-small.bin и обе части qwen3-4b-instruct.part-* в папку model-assets.\n${windows ? '3. Положите ollama-runtime-windows-x64.zip в model-assets. Запустите start.cmd.\n' : '3. Запустите start.command.\n'}4. Откроется браузер на http://127.0.0.1:3200. Держите окно запуска открытым.\n\nПосле скачивания интернет для работы не нужен. Данные и модели остаются на этом компьютере. При первом запуске части модели собираются в локальный файл; нужны несколько гигабайт свободного места.\n`;
await writeFile(path.join(out, 'README-OFFLINE.txt'), readme);
if (windows) {
  await writeFile(path.join(out, 'start.cmd'), `@echo off\r\ncd /d "%~dp0"\r\nif not exist "bin\\ollama\\ollama.exe" (\r\n  if not exist "model-assets\\ollama-runtime-windows-x64.zip" (\r\n    echo Нет model-assets\\ollama-runtime-windows-x64.zip\r\n    pause\r\n    exit /b 1\r\n  )\r\n  powershell -NoProfile -Command "Expand-Archive -LiteralPath 'model-assets\\ollama-runtime-windows-x64.zip' -DestinationPath 'bin\\ollama' -Force"\r\n  if errorlevel 1 (pause & exit /b 1)\r\n)\r\n"bin\\node.exe" launcher.mjs\r\npause\r\n`);
} else {
  await writeFile(path.join(out, 'start.command'), '#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec ./bin/node ./launcher.mjs\n', { mode: 0o755 });
}
console.log(`Автономное приложение собрано: ${out}`);
