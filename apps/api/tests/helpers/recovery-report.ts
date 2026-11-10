// Only fixed labels and bounded numbers may leave the test process as artifacts.
// Never include Vitest failureMessages, stacks, database URIs or BSON documents.
export const recoveryChecks = [
  { id: 'preflight', title: 'restore preflight defaults to dry run and rejects unsafe targets and missing approval' },
  { id: 'encryption', title: 'encrypted archives authenticate content and key before restore' },
  { id: 'native_restore', title: 'native encrypted backup restores an isolated replica set and application invariants' },
] as const;

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
const duration = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;

export function recoveryReport(raw: unknown, exitCode: number | null, elapsedMs: number,
  blocked?: 'DATABASE_TOOLS_MISSING' | 'RUNNER_FAILED') {
  const root = record(raw);
  const suites = Array.isArray(root.testResults) ? root.testResults : [];
  const assertions = suites.flatMap(suite => {
    const rows = record(suite).assertionResults;
    return Array.isArray(rows) ? rows.map(record) : [];
  });
  const checks = recoveryChecks.map(check => {
    const matches = assertions.filter(row => row.title === check.title);
    const row = matches.length === 1 ? matches[0]! : {};
    return {
      id: check.id,
      status: row.status === 'passed' ? 'passed' : row.status === 'failed' ? 'failed' : 'unverified',
      durationMs: duration(row.duration),
    };
  });
  const complete = root.success === true && assertions.length === recoveryChecks.length &&
    checks.every(check => check.status === 'passed');
  const status = !blocked && exitCode === 0 && complete ? 'passed' : 'failed';
  return {
    schemaVersion: 1,
    scope: 'synthetic-only',
    status,
    code: blocked ?? (status === 'passed' ? 'DRILL_PASSED' :
      checks.some(check => check.status === 'failed') ? 'DRILL_ASSERTION_FAILED' : 'DRILL_INCOMPLETE'),
    durationMs: duration(elapsedMs),
    checks,
    productionVerified: false,
    rpoVerified: false,
    rtoVerified: false,
  };
}

export function recoveryMarkdown(report: ReturnType<typeof recoveryReport>) {
  const names = { preflight: 'Xavfsiz target va tasdiq', encryption: 'Shifrlash va yaxlitlik',
    native_restore: 'Native backup/restore, indeks, moliya, RBAC va tenant izolyatsiyasi' };
  return `# Sintetik MongoDB recovery hisoboti\n\n` +
    `Natija: **${report.status}** (${report.code}). Davomiylik: ${report.durationMs ?? 'noma’lum'} ms.\n\n` +
    `| Tekshiruv | Natija | Vaqt (ms) |\n| --- | --- | --- |\n` +
    report.checks.map(check => `| ${names[check.id]} | ${check.status} | ${check.durationMs ?? '—'} |`).join('\n') +
    '\n\nProduction backup/restore va RPO/RTO **tasdiqlanmagan**. Bu faqat kichik, yozuvchisiz lokal fixture drilli.\n' +
    '\nXatoda shu CI jobining test natijasini tekshiring; vositalar, binary yuklanishi yoki assertion xatosini tuzatib qayta bajaring. Testni o‘tkazib yuborish muvaffaqiyat hisoblanmaydi.\n';
}
