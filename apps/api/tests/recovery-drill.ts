// Development/CI entrypoint only. No operator-supplied URI or production config.
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoveryReport, recoveryMarkdown } from './helpers/recovery-report.js';

const apiDir = fileURLToPath(new URL('..', import.meta.url));
const outputRoot = fileURLToPath(new URL('../../../work/recovery/', import.meta.url));
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'run-'));
const scratch = await mkdtemp(join(tmpdir(), 'softlans-dr-report-'));
const startedAt = new Date().toISOString();
const started = performance.now();
// App credentials, NODE_OPTIONS and externally supplied database targets do not
// enter Vitest or its native tools. Keep only local runtime/download settings.
const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', DR_DRILL_CONFIRM: 'synthetic-only' };
for (const name of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'MONGOMS_DOWNLOAD_DIR', 'MONGOMS_SYSTEM_BINARY']) {
  if (process.env[name] !== undefined) env[name] = process.env[name];
}
let raw: unknown;
let exitCode: number | null = null;
let blocked: 'DATABASE_TOOLS_MISSING' | 'RUNNER_FAILED' | undefined;
try {
  if (process.argv.length > 2) throw new Error('Arguments are not accepted');
  const toolsReady = ['mongodump', 'mongorestore'].every(command =>
    spawnSync(command, ['--version'], { env, stdio: 'ignore', timeout: 10_000 }).status === 0);
  if (!toolsReady) blocked = 'DATABASE_TOOLS_MISSING';
  else {
    const resultPath = join(scratch, 'vitest.json');
    const child = spawnSync(process.execPath, [
      fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)),
      'run', 'tests/recovery.test.ts', '--reporter=default', '--reporter=json',
      `--outputFile.json=${resultPath}`,
    ], { cwd: apiDir, env, stdio: 'inherit', timeout: 300_000 });
    exitCode = child.status;
    if (child.error || child.signal) blocked = 'RUNNER_FAILED';
    // A unique temporary directory prevents a stale PASS from a previous run.
    try { raw = JSON.parse(await readFile(resultPath, 'utf8')); } catch { /* fail closed */ }
  }
} catch {
  blocked = 'RUNNER_FAILED';
} finally {
  await rm(scratch, { recursive: true, force: true });
}
const report = { ...recoveryReport(raw, exitCode, performance.now() - started, blocked),
  startedAt, finishedAt: new Date().toISOString() };
const markdown = recoveryMarkdown(report);
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
await writeFile(join(output, 'report.md'), markdown, { mode: 0o600 });
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
console.info(markdown);
console.info(`Hisobot: ${output}/report.json`);
process.exitCode = report.status === 'passed' ? 0 : 1;
