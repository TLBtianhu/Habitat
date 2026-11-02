// Agent 发布 AppSession 快照；Desktop / Outlet 只读，不反向修改。
import fs from 'node:fs';
import path from 'node:path';

export function sessionSnapshotPath() {
  return process.env.HABITAT_SESSION_PATH || '/var/lib/habitat/app-sessions.json';
}

export function publishSessionSnapshot(registry, file = sessionSnapshotPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registry.snapshot(), null, 2));
  fs.renameSync(tmp, file);
  return file;
}

export function readSessionSnapshot(file = sessionSnapshotPath()) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && Array.isArray(value.apps) ? value : null;
  } catch {
    return null;
  }
}
