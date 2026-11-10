import { expect, it } from 'vitest';
import { recoveryChecks, recoveryReport, recoveryMarkdown } from './helpers/recovery-report.js';

const results = () => ({ success: true, testResults: [{ assertionResults:
  recoveryChecks.map(check => ({ title: check.title, status: 'passed', duration: 12.4 })) }] });

it('requires every actual recovery check and a successful process exit', () => {
  expect(recoveryReport(results(), 0, 20)).toMatchObject({ status: 'passed', code: 'DRILL_PASSED',
    productionVerified: false, rpoVerified: false, rtoVerified: false });
  for (const exit of [null, 1]) expect(recoveryReport(results(), exit, 20).status).toBe('failed');
  expect(recoveryReport({ ...results(), success: false }, 0, 20).status).toBe('failed');
});

it('fails closed on skipped, missing, duplicate, malformed and failed test evidence', () => {
  for (const status of ['skipped', 'pending', 'todo', 'failed']) {
    const raw = results();
    raw.testResults[0]!.assertionResults[2]!.status = status;
    expect(recoveryReport(raw, 0, 20).status).toBe('failed');
  }
  const missing = results(); missing.testResults[0]!.assertionResults.pop();
  const duplicate = results(); duplicate.testResults[0]!.assertionResults.push(duplicate.testResults[0]!.assertionResults[0]!);
  for (const raw of [undefined, null, {}, { testResults: [null] }, missing, duplicate])
    expect(recoveryReport(raw, 0, 20).status).toBe('failed');
});

it('reports missing tools and runner failures without passing stale results', () => {
  for (const code of ['DATABASE_TOOLS_MISSING', 'RUNNER_FAILED'] as const)
    expect(recoveryReport(results(), 0, 20, code)).toMatchObject({ status: 'failed', code });
  expect(recoveryReport(undefined, 0, NaN).durationMs).toBeNull();
});

it('never copies arbitrary diagnostics or non-finite metrics into saved artifacts', () => {
  const secret = 'mongodb://user:secret@production.invalid/db';
  const raw = results();
  Object.assign(raw, { message: secret, error: secret });
  Object.assign(raw.testResults[0]!.assertionResults[2]!, {
    status: 'failed', failureMessages: [secret], fullName: secret, duration: Infinity,
  });
  const report = recoveryReport(raw, 1, -10);
  expect(report).toMatchObject({ status: 'failed', code: 'DRILL_ASSERTION_FAILED', durationMs: null });
  expect(report.checks[2]!.durationMs).toBeNull();
  expect(JSON.stringify(report) + recoveryMarkdown(report)).not.toContain(secret);
});
