import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function checkedPath(root, relative) {
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(path.resolve(root) + path.sep)) {
    throw new Error(`Недопустимый путь модели: ${relative}`);
  }
  return absolute;
}

export async function prepareModels(root, metadata) {
  const assetsDir = path.join(root, 'model-assets');
  const whisperFile = checkedPath(assetsDir, metadata.whisper.file);
  try {
    if ((await stat(whisperFile)).size !== metadata.whisper.size || await sha256(whisperFile) !== metadata.whisper.sha256) {
      throw new Error('Контрольная сумма модели речи не совпадает. Скачайте файл снова.');
    }
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Нет файла ${metadata.whisper.file} в папке model-assets.`, { cause: error });
    throw error;
  }

  const storeDir = path.join(root, 'models', 'ollama');
  for (const item of metadata.smallFiles) {
    const target = checkedPath(storeDir, item.path);
    await mkdir(path.dirname(target), { recursive: true });
    const bytes = Buffer.from(item.base64, 'base64');
    if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error(`Повреждены данные модели: ${item.path}`);
    await writeFile(target, bytes);
  }

  const blob = checkedPath(storeDir, `blobs/sha256-${metadata.ollama.sha256}`);
  try {
    if ((await stat(blob)).size === metadata.ollama.size && await sha256(blob) === metadata.ollama.sha256) {
      return { whisperFile, storeDir };
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await mkdir(path.dirname(blob), { recursive: true });
  const temp = `${blob}.partial`;
  const output = createWriteStream(temp, { flags: 'w', mode: 0o600 });
  const hash = createHash('sha256');
  let total = 0;
  try {
    for (const part of metadata.ollama.parts) {
      const source = checkedPath(assetsDir, part.file);
      try {
        if ((await stat(source)).size !== part.size || await sha256(source) !== part.sha256) {
          throw new Error(`Файл ${part.file} повреждён. Скачайте его снова.`);
        }
      } catch (error) {
        if (error.code === 'ENOENT') throw new Error(`Нет файла ${part.file} в папке model-assets.`, { cause: error });
        throw error;
      }
      for await (const chunk of createReadStream(source)) {
        hash.update(chunk);
        total += chunk.length;
        if (!output.write(chunk)) await new Promise((resolve) => output.once('drain', resolve));
      }
    }
    await new Promise((resolve, reject) => output.end((error) => error ? reject(error) : resolve()));
    if (total !== metadata.ollama.size || hash.digest('hex') !== metadata.ollama.sha256) {
      throw new Error('Контрольная сумма модели анализа не совпадает. Скачайте части снова.');
    }
    await rename(temp, blob);
  } catch (error) {
    output.destroy();
    await rm(temp, { force: true });
    throw error;
  }
  return { whisperFile, storeDir };
}

export async function loadModelMetadata(root) {
  return JSON.parse(await readFile(path.join(root, 'offline-model.json'), 'utf8'));
}
