import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AfterActionStore, verifyChecks } from './after-action.mjs';

assert.equal(verifyChecks([]).outcome, 'unknown');
assert.equal(verifyChecks([{ name: 'bad', ok: false, evidence: 'HTTP 500' }]).outcome, 'verified_failure');
assert.equal(verifyChecks([{ name: 'ok', ok: true, evidence: 'id-1' }]).outcome, 'verified_success');
assert.equal(verifyChecks([{ name: 'missing', ok: true, evidence: null }]).outcome, 'unknown');
assert.equal(verifyChecks([{ name: 'optional', ok: false, optional: true, evidence: 'degraded' }]).outcome, 'verified_partial');
assert.equal(verifyChecks([{ name: 'optional', ok: true, optional: true, evidence: 'ok' }]).outcome, 'verified_success');

const file = `/tmp/habitat-after-action-test-${process.pid}.jsonl`;
try {
  const store = new AfterActionStore({ file });
  const report = store.record({
    taskId: 'task-1',
    residenceId: 'qq.group.1',
    goal: 'send Bearer abcdefgh',
    selfReport: { outcome: 'success', summary: 'I succeeded', confidence: 0.9 },
    checks: [{ name: 'accepted', ok: false, evidence: 'HTTP 500' }],
  });
  assert.equal(report.verification.outcome, 'verified_failure', '自评成功不能覆盖客观失败');
  assert.equal(report.selfReport.outcome, 'success');
  assert.equal(report.goal.includes('abcdefgh'), false);
  assert.equal(store.list({ residenceId: 'qq.group.1' }).length, 1);
  assert.equal(store.list({ residenceId: 'qq.group.2' }).length, 0);
  console.log('ok: 自评与验证分离、缺证据 unknown、失败不可覆盖、residence 隔离与脱敏');
} finally {
  fs.rmSync(file, { force: true });
}
