// Voice Library：音色清单、权限与后端选择；不让 Agent 接触任意模型路径。
import fs from 'node:fs';
import path from 'node:path';
import { createVoiceBackend } from './backends/index.mjs';
import { readSessionSnapshot } from '../desktop/session-store.mjs';

function failure(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

export class VoiceLibrary {
  constructor({ directory, defaultId = 'generic/kokoro-zf-xiaoni', policyPath = '/etc/habitat/voice.json' }) {
    this.defaultId = defaultId;
    this.policyPath = policyPath;
    this.profiles = new Map();
    this.backends = new Map();
    for (const file of fs.readdirSync(directory)) {
      if (!file.endsWith('.json')) continue;
      const profile = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
      this.profiles.set(profile.id, {
        kind: 'test',
        enabled: true,
        dafeiyu: false,
        ...profile,
      });
    }
    try {
      const policy = JSON.parse(fs.readFileSync(this.policyPath, 'utf8'));
      if (policy.defaultProfile && this.profiles.get(policy.defaultProfile)?.enabled) {
        this.defaultId = policy.defaultProfile;
      }
    } catch {}
  }

  setDefault(id) {
    const profile = this.get(id);
    this.defaultId = profile.id;
    const tmp = `${this.policyPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, defaultProfile: profile.id }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.policyPath);
    return profile;
  }

  get(id = this.defaultId) {
    const profile = this.profiles.get(id);
    if (!profile) throw failure(400, 'unknown voice profile: ' + id);
    if (!profile.enabled) throw failure(409, 'voice profile disabled: ' + id);
    return profile;
  }

  backendFor(id) {
    const profile = this.get(id);
    if (!this.backends.has(profile.id)) {
      const backend = createVoiceBackend(profile);
      this.backends.set(profile.id, backend);
    }
    return this.backends.get(profile.id);
  }

  enabled() {
    const snapshot = readSessionSnapshot();
    const app = snapshot?.apps.find((s) => s.appId === 'voice.library');
    return app ? app.state !== 'closed' : true;
  }

  describe() {
    return {
      appId: 'voice.library',
      state: this.enabled() ? 'open' : 'closed',
      defaultProfile: this.defaultId,
      profiles: [...this.profiles.values()].map((p) => {
        const available = p.enabled ? this.backendFor(p.id).probe().available : false;
        return {
          id: p.id,
          label: p.label,
          kind: p.kind,
          enabled: p.enabled,
          dafeiyu: p.dafeiyu === true,
          backend: p.backend,
          speaker: p.speaker || p.voice || null,
          available,
          sampleUrl: p.sampleUrl || null,
        };
      }),
    };
  }
}
