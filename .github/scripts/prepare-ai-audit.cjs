'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PRICING_DATE = '2026-11-09';
const PRICING_EXPIRES = Date.parse('2026-12-09T00:00:00Z');
const MAX_EVIDENCE_BYTES = 96_000;

function redact(value) {
  return String(value)
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[MongoDB manzili yashirildi]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]+)\b/g, '[kalit yashirildi]')
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[Telegram kaliti yashirildi]')
    .replace(/((?:password|secret|api[_-]?key|token)\s*[=:]\s*)[^\s,;]+/gi, '$1[yashirildi]')
    .replace(/@[\w-]+/g, '[mention]');
}

function truncate(value, bytes = MAX_EVIDENCE_BYTES) {
  const text = redact(value);
  if (Buffer.byteLength(text) <= bytes) return text;
  return Buffer.from(text).subarray(0, bytes).toString('utf8') +
    '\n[Dalillar hajm chegarasida qisqartirildi; to‘liq audit emas.]';
}

async function authorize({ github, context, core, now = Date.now() }) {
  const event = context.eventName;
  const pr = context.payload.pull_request;
  const deny = (reason) => {
    core.setOutput('allowed', 'false');
    core.notice(`AI audit o‘tkazib yuborildi: ${reason}`);
    return false;
  };
  if (!['pull_request_target', 'schedule', 'workflow_dispatch'].includes(event)) return deny('hodisa ruxsat etilmagan');
  if (process.env.GITHUB_RUN_ATTEMPT !== '1') return deny('qayta ishga tushirish taqiqlangan');
  if (process.env.AI_PRICING_REVIEWED_ON !== PRICING_DATE || now >= PRICING_EXPIRES || now < Date.parse(PRICING_DATE)) {
    return deny('tarif siyosati tasdiqlanmagan yoki muddati tugagan');
  }
  if (event === 'workflow_dispatch' && context.ref !== 'refs/heads/main') return deny('faqat main');
  if (event === 'pull_request_target' && (!pr || pr.draft || pr.base.ref !== 'main' ||
      pr.head.repo?.full_name !== `${context.repo.owner}/${context.repo.repo}`)) return deny('fork, draft yoki boshqa base');
  const actors = new Set([context.actor, process.env.GITHUB_TRIGGERING_ACTOR]);
  for (const username of actors) {
    if (!username || username.endsWith('[bot]')) return deny('bot yoki noma’lum actor');
    const { data } = await github.rest.repos.getCollaboratorPermissionLevel({ ...context.repo, username });
    if (!['admin', 'maintain', 'write'].includes(data.permission)) return deny('maintainer huquqi yo‘q');
  }
  core.setOutput('allowed', 'true');
  return true;
}

function dependencyEvidence() {
  let raw;
  try {
    raw = execFileSync('npm', ['audit', '--json', '--package-lock-only', '--ignore-scripts'], {
      timeout: 30_000, maxBuffer: 2_000_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NPM_CONFIG_FETCH_RETRIES: '0' },
    });
  } catch (error) {
    // npm audit exits 1 for findings. Network/invalid JSON is an unknown result.
    raw = error.stdout;
  }
  try {
    const result = JSON.parse(String(raw));
    if (result.error || !result.metadata?.vulnerabilities) throw new Error('audit unavailable');
    return {
      counts: result.metadata.vulnerabilities,
      findings: Object.values(result.vulnerabilities || {}).slice(0, 40).map(v => ({
        name: v.name, severity: v.severity, direct: v.isDirect, fixAvailable: Boolean(v.fixAvailable),
      })),
    };
  } catch {
    return { unavailable: 'Dependency auditi yakunlanmadi; xavfsiz deb xulosa qilmang.' };
  }
}

async function prepare({ github, context, core }) {
  let evidence;
  if (context.eventName === 'pull_request_target') {
    const prNumber = context.payload.pull_request.number;
    // Recheck mutable PR metadata. Never use a branch name as a shell command.
    const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: prNumber });
    if (pr.state !== 'open' || pr.draft || pr.base.ref !== 'main' ||
        pr.head.repo?.full_name !== `${context.repo.owner}/${context.repo.repo}` ||
        pr.head.sha !== context.payload.pull_request.head.sha) {
      throw new Error('PR holati o‘zgardi; audit to‘xtatildi.');
    }
    const { data: diff } = await github.rest.pulls.get({
      ...context.repo, pull_number: prNumber, mediaType: { format: 'diff' },
      request: { timeout: 30_000 },
    });
    evidence = `PR #${prNumber}; base=${pr.base.sha}; head=${pr.head.sha}\n` +
      'Faqat ushbu diff tekshiriladi. Testlar bu job’da bajarilmadi.\n' + diff;
  } else {
    let todos = '';
    try {
      todos = execFileSync('git', ['grep', '-n', '-I', '-E', 'TODO|FIXME|HACK|XXX', '--', 'apps', 'packages'], {
        timeout: 10_000, maxBuffer: 300_000, encoding: 'utf8',
      });
    } catch (error) {
      if (error.status !== 1) throw new Error('Statik vazifalar tekshiruvi yakunlanmadi.');
    }
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const { data } = await github.rest.actions.listWorkflowRuns({
      ...context.repo, workflow_id: 'ci.yml', branch: 'main', per_page: 5,
      request: { timeout: 15_000 },
    });
    evidence = JSON.stringify({
      commit: sha,
      note: 'Statik audit. Testlar bajarilmadi. Boshqa SHA’dagi CI bu commit uchun dalil emas. TODO yo‘qligi barcha vazifalar tugaganini bildirmaydi.',
      recentCI: data.workflow_runs.map(r => ({ sha: r.head_sha, status: r.status, conclusion: r.conclusion, url: r.html_url })),
      todos: truncate(todos || 'TODO/FIXME/HACK/XXX markerlari topilmadi.', 24_000),
      dependencyAudit: dependencyEvidence(),
      workspaceScripts: ['package.json', 'apps/api/package.json', 'apps/web/package.json', 'packages/contracts/package.json']
        .map(file => ({ file, scripts: JSON.parse(fs.readFileSync(file, 'utf8')).scripts })),
      ci: fs.readFileSync('.github/workflows/ci.yml', 'utf8'),
    }, null, 2);
  }
  const prompt = fs.readFileSync('.github/prompts/readonly-audit.txt', 'utf8') +
    '\n<ISHONCHSIZ_DALILLAR>\n' + truncate(evidence) + '\n</ISHONCHSIZ_DALILLAR>\n';
  const directory = path.join(process.env.RUNNER_TEMP, 'softlans-ai-input');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(process.env.RUNNER_TEMP, 'softlans-codex-home'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'prompt.txt'), prompt, { mode: 0o600 });
  await core.summary.addRaw('AI audit: faqat statik dalillar; maksimal API rezervi $0.60, 1 so‘rov. Natija oxirgi Codex step logida.\n').write();
}

module.exports = { authorize, prepare, redact, truncate, PRICING_DATE, PRICING_EXPIRES };
