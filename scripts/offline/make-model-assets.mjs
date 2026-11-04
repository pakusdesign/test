import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const store = process.env.OLLAMA_MODELS;
const whisper = process.env.WHISPER_MODEL;
const out = process.env.OUT_DIR;
const model = process.env.LLM_MODEL ?? 'qwen3:4b-instruct';
if (!store || !whisper || !out) throw new Error('Нужны OLLAMA_MODELS, WHISPER_MODEL и OUT_DIR.');

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function walk(dir, relative = '') {
  const result = [];
  for (const entry of await readdir(path.join(dir, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await walk(dir, next));
    else if (entry.isFile()) result.push(next);
  }
  return result;
}

const files = await walk(store);
const blobs = await Promise.all(files.filter((file) => file.startsWith(`blobs${path.sep}`)).map(async (file) => ({ file, size: (await stat(path.join(store, file))).size })));
blobs.sort((a, b) => b.size - a.size);
const largest = blobs[0];
if (!largest || largest.size < 1_000_000_000 || !largest.file.startsWith(`blobs${path.sep}sha256-`)) {
  throw new Error('Большой blob Ollama не найден. Сначала загрузите qwen3:4b-instruct.');
}
const digest = largest.file.split('sha256-')[1];
if (await hashFile(path.join(store, largest.file)) !== digest) throw new Error('Повреждён blob Ollama.');

const manifest = path.join('manifests', 'registry.ollama.ai', 'library', 'qwen3', '4b-instruct');
const manifestText = await readFile(path.join(store, manifest), 'utf8');
if (!manifestText.includes(`sha256:${digest}`)) throw new Error('Модель не совпадает с манифестом qwen3:4b-instruct.');

const assets = path.join(out, 'model-assets');
await mkdir(assets, { recursive: true });
const whisperName = 'ggml-small.bin';
await copyFile(whisper, path.join(assets, whisperName));
const whisperSize = (await stat(whisper)).size;
const whisperHash = await hashFile(whisper);

const partSize = 1_500_000_000;
const parts = [];
for (let start = 0, index = 1; start < largest.size; start += partSize, index++) {
  const size = Math.min(partSize, largest.size - start);
  const name = `qwen3-4b-instruct.part-${String(index).padStart(2, '0')}`;
  const destination = path.join(assets, name);
  const output = createWriteStream(destination);
  for await (const chunk of createReadStream(path.join(store, largest.file), { start, end: start + size - 1 })) {
    if (!output.write(chunk)) await new Promise((resolve) => output.once('drain', resolve));
  }
  await new Promise((resolve) => output.end(resolve));
  parts.push({ file: name, size, sha256: await hashFile(destination) });
}

const smallFiles = [];
for (const file of files.filter((item) => item !== largest.file && !item.startsWith(`metadata${path.sep}`))) {
  const bytes = await readFile(path.join(store, file));
  smallFiles.push({ path: file.split(path.sep).join('/'), sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') });
}
const metadata = {
  schemaVersion: 1,
  whisper: { file: whisperName, size: whisperSize, sha256: whisperHash },
  ollama: { model, sha256: digest, size: largest.size, parts },
  smallFiles,
};
await writeFile(path.join(out, 'offline-model.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify({ whisperSize, ollamaSize: largest.size, parts: parts.map(({ file, size }) => ({ file, size })) }));
