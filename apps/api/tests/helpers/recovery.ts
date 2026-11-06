// Test-only harness. Never accepts an operator-supplied production endpoint.
import mongoose from 'mongoose';
import { execFile } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

export function preflight(uri: string, target: string, confirmation?: string, execute = false) {
  if (!/^dr_restore_[a-f0-9]{32}$/.test(target)) throw new Error('Aniq sintetik target talab qilinadi');
  let url: URL;
  try { url = new URL(uri); } catch { throw new Error('Lokal URI talab qilinadi'); }
  if (url.protocol !== 'mongodb:' || url.hostname !== '127.0.0.1' || !url.port ||
      url.username || url.password || url.pathname !== `/${target}` ||
      [...url.searchParams.keys()].some(k => k !== 'replicaSet') ||
      !url.searchParams.get('replicaSet')) throw new Error('Faqat lokal disposable replica set');
  if (execute && confirmation !== `RESTORE_SYNTHETIC:${target}`) throw new Error('Tasdiq talab qilinadi');
  return { dryRun: !execute };
}
export function seal(data: Buffer, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}
export function unseal(data: Buffer, key: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
}
// Bounded in-memory native archive: exclusively for tiny synthetic fixtures.
// stderr is discarded; tool failures cannot leak a URI or document into CI logs.
function tool(command: string, args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout: 60_000 },
      (error, stdout) => error ? reject(new Error('Mahalliy MongoDB vositasi muvaffaqiyatsiz')) : resolve(stdout));
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}
export async function backupSynthetic(uri: string, source: string, path: string, key: Buffer) {
  if (!/^dr_source_[a-f0-9]{32}$/.test(source)) throw new Error('Sintetik source talab qilinadi');
  preflight(uri.replace(`/${source}?`, `/${source.replace('source', 'restore')}?`), source.replace('source', 'restore'));
  const archive = await tool('mongodump', ['--uri', uri, '--archive']);
  await writeFile(path, seal(archive, key), { mode: 0o600, flag: 'wx' });
}
export async function restoreSynthetic(uri: string, source: string, target: string, path: string, key: Buffer,
  confirmation?: string, execute = false) {
  const result = preflight(uri, target, confirmation, execute);
  if (!/^dr_source_[a-f0-9]{32}$/.test(source)) throw new Error('Sintetik source talab qilinadi');
  if (result.dryRun) return result;
  // Authenticate the entire archive BEFORE allowing any database writes.
  const archive = unseal(await readFile(path), key);
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    if ((await client.db(target).listCollections().toArray()).length) throw new Error('Target bo‘sh bo‘lishi shart');
  } finally { await client.close(); }
  await tool('mongorestore', ['--uri', uri, '--archive', '--nsInclude', `${source}.*`,
    '--nsFrom', `${source}.*`, '--nsTo', `${target}.*`, '--stopOnError'], archive);
  return result;
}
