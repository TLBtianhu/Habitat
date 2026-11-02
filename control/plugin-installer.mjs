// Owner-approved plugin installation from a signed index and artifact bundle.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PluginRegistry } from '../adapters/plugin-registry.mjs';
import { validateManifest } from '../adapters/plugin-manifest.mjs';

function canonicalJson(value) { return JSON.stringify(value, null, 2) + '\n'; }
function matchesRevocation(list, item) {
  return (list || []).some((entry) => {
    if (typeof entry === 'string') return entry === item.id || entry === item.hash || entry === `${item.id}:${item.version}`;
    return entry && (entry.id === item.id || entry.sha256 === item.hash)
      && (!entry.version || entry.version === item.version);
  });
}
function withRevocations(index, revocations) {
  Object.defineProperty(index, 'revocationsData', { value: revocations, enumerable: false });
  return index;
}
function safeJoin(root, name) {
  const target = path.resolve(root, name);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('unsafe extraction path');
  return target;
}
export function extractZipSafe(file, dest) {
  const code = `
import zipfile, os, sys
file, dest = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(file) as z:
    infos = z.infolist()
    if len(infos) > 20000: raise ValueError('too many files')
    total = sum(i.file_size for i in infos)
    if total > 4 * 1024 * 1024 * 1024: raise ValueError('archive too large')
    for info in infos:
        name = info.filename.replace('\\\\', '/')
        if name.startswith('/') or '..' in name.split('/'):
            raise ValueError('unsafe path: ' + name)
        target = os.path.realpath(os.path.join(dest, info.filename))
        if os.path.commonpath([os.path.realpath(dest), target]) != os.path.realpath(dest):
            raise ValueError('path escapes destination')
        if (info.external_attr >> 16) & 0o170000 == 0o120000:
            raise ValueError('symlink not allowed')
    z.extractall(dest)
`;
  const python = process.platform === 'win32' ? 'py' : 'python3';
  const args = process.platform === 'win32' ? ['-3', '-c', code, file, dest] : ['-c', code, file, dest];
  execFileSync(python, args, { stdio: 'inherit' });
}

export class PluginInstaller {
  constructor({ indexUrl = 'https://github.com/TLBtianhu/habitat-plugins/releases/latest/download/index.json', cacheDir = '/var/lib/habitat/plugins' } = {}) {
    this.indexUrl = indexUrl;
    this.cacheDir = cacheDir;
  }

  async _fetch(url, { buffer = false } = {}) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`plugin fetch failed: HTTP ${response.status}`);
        return buffer ? Buffer.from(await response.arrayBuffer()) : response.text();
      } catch (error) {
        lastError = error;
        if (attempt < 1) await new Promise((r) => setTimeout(r, 250));
      }
    }
    const output = execFileSync('curl', ['-L', '--fail', '--retry', '2', '--retry-delay', '1', '--max-time', '30', '-fsS', url], {
      maxBuffer: 512 * 1024 * 1024,
    });
    return buffer ? output : output.toString('utf8');
  }

  async _index() {
    let indexText;
    let sigText;
    let publicKey;
    try {
      indexText = await this._fetch(this.indexUrl);
      sigText = await this._fetch(new URL('index.sig.json', this.indexUrl).href);
      publicKey = await this._fetch(new URL('release-public-key.pem', this.indexUrl).href);
    } catch (error) {
      return this._cachedIndex(error);
    }
    const index = JSON.parse(indexText);
    const sig = JSON.parse(sigText);
    if (!crypto.verify(null, canonicalJson(index), publicKey, Buffer.from(sig.signature, 'base64'))) {
      throw new Error('plugin index signature invalid');
    }
    let revocationsText;
    let revocationsSigText;
    try {
      const revocationsUrl = new URL(index.revocations || 'revocations.json', this.indexUrl);
      revocationsText = await this._fetch(revocationsUrl.href);
      revocationsSigText = await this._fetch(new URL('revocations.sig.json', revocationsUrl).href);
    } catch (error) {
      return this._cachedIndex(error);
    }
    const revocations = JSON.parse(revocationsText);
    const revocationsSig = JSON.parse(revocationsSigText);
    if (!Array.isArray(revocations.revoked) || !crypto.verify(null, canonicalJson(revocations), publicKey, Buffer.from(revocationsSig.signature, 'base64'))) {
      throw new Error('plugin revocations signature invalid');
    }
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.writeFileSync(path.join(this.cacheDir, 'index-cache.json'), JSON.stringify({ index, sig, publicKey, revocations, revocationsSig, fetchedAt: Date.now() }), { mode: 0o600 });
    return withRevocations(index, revocations);
  }

  _cachedIndex(error) {
    const file = path.join(this.cacheDir, 'index-cache.json');
    if (!fs.existsSync(file)) throw error;
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - cached.fetchedAt > 24 * 60 * 60 * 1000) throw error;
    if (!crypto.verify(null, canonicalJson(cached.index), cached.publicKey, Buffer.from(cached.sig.signature, 'base64'))) {
      throw new Error('cached plugin index signature invalid');
    }
    if (cached.revocations && (!Array.isArray(cached.revocations.revoked) || !crypto.verify(null, canonicalJson(cached.revocations), cached.publicKey, Buffer.from(cached.revocationsSig.signature, 'base64')))) {
      throw new Error('cached revocations signature invalid');
    }
    return withRevocations(cached.index, cached.revocations || { revoked: [] });
  }

  async install(id, { approvedBy = 'owner' } = {}) {
    if (approvedBy !== 'owner') throw new Error('owner approval required');
    const index = await this._index();
    const plugin = index.plugins.find((item) => item.id === id);
    if (!plugin) throw new Error('plugin not found: ' + id);
    if (plugin.revoked || this._revocationMatches({ id, version: plugin.version, hash: plugin.artifact.sha256 }) || matchesRevocation(index.revocationsData?.revoked, { id, version: plugin.version, hash: plugin.artifact.sha256 })) {
      throw new Error('plugin revoked: ' + id);
    }
    const artifact = plugin.artifact;
    const bytes = await this._fetch(artifact.url, { buffer: true });
    if (bytes.length > 512 * 1024 * 1024) throw new Error('plugin artifact too large');
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (hash !== artifact.sha256) throw new Error('plugin artifact hash mismatch');

    const downloadDir = path.join(this.cacheDir, 'downloads');
    const installedDir = path.join(this.cacheDir, 'installed', id);
    const staging = path.join(this.cacheDir, `.staging-${id}-${process.pid}`);
    fs.mkdirSync(downloadDir, { recursive: true });
    const archive = path.join(downloadDir, `app-${id}.zip`);
    fs.writeFileSync(archive, bytes, { mode: 0o600 });
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    extractZipSafe(archive, staging);

    const manifestPath = path.join(staging, `adapters/${id}/manifest.json`);
    const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), manifestPath);
    if (manifest.id !== id) throw new Error('plugin id mismatch in manifest');
    fs.rmSync(installedDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(installedDir), { recursive: true });
    fs.renameSync(staging, installedDir);
    const metadata = { id, version: plugin.version, hash, installedAt: Date.now(), entry: plugin.entry, enabled: true };
    fs.writeFileSync(path.join(this.cacheDir, 'installed', `${id}.install.json`), JSON.stringify(metadata, null, 2), { mode: 0o600 });
    return metadata;
  }

  _metadata(id) {
    if (!/^[a-z][a-z0-9._-]*$/.test(id)) throw new Error('invalid plugin id');
    const file = path.join(this.cacheDir, 'installed', `${id}.install.json`);
    if (!fs.existsSync(file)) throw new Error('plugin not installed: ' + id);
    return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
  }

  _localRevocations() {
    const file = path.join(this.cacheDir, 'revocations.json');
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8')).revoked || [];
  }

  _cachedRevocations() {
    const file = path.join(this.cacheDir, 'index-cache.json');
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8')).revocations?.revoked || [];
  }

  _revocationMatches(item) {
    return matchesRevocation([...this._localRevocations(), ...this._cachedRevocations()], item);
  }

  installed() {
    const dir = path.join(this.cacheDir, 'installed');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.install.json')).map((file) => {
      const item = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      return { ...item, enabled: item.enabled !== false, revoked: this._revocationMatches(item) };
    });
  }

  _setEnabled(id, enabled) {
    const { file, data } = this._metadata(id);
    if (enabled && this._revocationMatches(data)) throw new Error('plugin revoked: ' + id);
    const next = { ...data, enabled, ...(enabled ? { enabledAt: Date.now() } : { disabledAt: Date.now() }) };
    fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
    return { ...next, revoked: this._revocationMatches(next) };
  }

  disable(id) { return this._setEnabled(id, false); }
  enable(id) { return this._setEnabled(id, true); }

  revoke(id) {
    const { data } = this._metadata(id);
    const file = path.join(this.cacheDir, 'revocations.json');
    const revoked = [...new Set([...this._localRevocations(), id])];
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, revoked }, null, 2), { mode: 0o600 });
    return this._setEnabled(id, false);
  }

  unrevoke(id) {
    const file = path.join(this.cacheDir, 'revocations.json');
    const revoked = this._localRevocations().filter((entry) => entry !== id);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, revoked }, null, 2), { mode: 0o600 });
    return { id, revoked: this._cachedRevocations().includes(id), enabled: false };
  }

  uninstall(id) {
    this._metadata(id);
    fs.rmSync(path.join(this.cacheDir, 'installed', id), { recursive: true, force: true });
    fs.rmSync(path.join(this.cacheDir, 'installed', `${id}.install.json`), { force: true });
    return { id, uninstalled: true };
  }

  registry(baseDirs = [], options = {}) {
    const installed = this.installed();
    const installedIds = new Set(installed.map((item) => item.id));
    const dirs = installed.filter((item) => item.enabled && !item.revoked)
      .map((item) => path.join(this.cacheDir, 'installed', item.id, 'adapters'));
    const excludeIds = new Set([...(options.excludeIds || []), ...installedIds]);
    const installedRegistry = PluginRegistry.fromDirectories(dirs, options);
    const baseRegistry = PluginRegistry.fromDirectories(baseDirs, { ...options, excludeIds });
    return new PluginRegistry({ ...options, manifests: [...installedRegistry.list(), ...baseRegistry.list()] });
  }
}
