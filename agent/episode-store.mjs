// EpisodeStore：按 episodeId 持久化 checkpoint，重启恢复，不用应用开关决定记忆寿命。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Episode } from './episode.mjs';

export class EpisodeStore {
  constructor({ root = '/var/lib/habitat/episodes' } = {}) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  }

  file(id) { return path.join(this.root, crypto.createHash('sha256').update(id).digest('hex').slice(0, 24) + '.json'); }

  save(episode) {
    const file = this.file(episode.id);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, ...episode.snapshot() }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    return episode;
  }

  get(id) {
    try {
      const data = JSON.parse(fs.readFileSync(this.file(id), 'utf8'));
      if (data.schemaVersion !== 1) return null;
      return new Episode(data);
    } catch { return null; }
  }

  create(data) { return this.save(Episode.create(data)); }

  list() {
    return fs.readdirSync(this.root).filter((f) => f.endsWith('.json')).map((file) => {
      try { return new Episode(JSON.parse(fs.readFileSync(path.join(this.root, file), 'utf8'))); }
      catch { return null; }
    }).filter(Boolean);
  }
}
