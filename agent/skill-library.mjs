// SkillLibrary：只保存经过验证的成功步骤元数据，不生成或执行任意代码。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class SkillLibrary {
  constructor({ file = '/var/lib/habitat/skill-library.json' } = {}) {
    this.file = file;
    this.skills = new Map();
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const skill of saved.skills || []) this.skills.set(skill.id, skill);
    } catch {}
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, skills: this.list() }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  record({ episode, write, report }) {
    if (!episode || !write || !report || report.taskId !== write.id) throw new Error('episode/write/report mismatch');
    if (report.verification?.outcome !== 'verified_success' || write.status !== 'confirmed') {
      return { recorded: false, reason: 'verified_success_required' };
    }
    if (!episode.canRead(report.residenceId || 'system')) return { recorded: false, reason: 'residence_not_in_episode' };
    const parameterNames = Object.keys(write.data?.args || {}).sort();
    const id = 'procedure:' + crypto.createHash('sha256').update(write.kind + '\0' + parameterNames.join(',')).digest('hex').slice(0, 24);
    const previous = this.skills.get(id);
    const skill = {
      id,
      kind: 'verified-procedure',
      verb: write.kind,
      parameterNames,
      successCount: (previous?.successCount || 0) + 1,
      evidence: [...(previous?.evidence || []), report.id].slice(-10),
      firstVerifiedAt: previous?.firstVerifiedAt || report.createdAt,
      lastVerifiedAt: report.createdAt,
    };
    this.skills.set(id, skill);
    this._save();
    return { recorded: true, skill: { ...skill, evidence: [...skill.evidence] } };
  }

  list() { return [...this.skills.values()].map((skill) => ({ ...skill, evidence: [...skill.evidence] })); }
  get(id) { return this.list().find((skill) => skill.id === id) || null; }
}
