import { EspeakBackend } from './espeak-ng.mjs';
import { KokoroBackend } from './kokoro.mjs';

export function createVoiceBackend(profile) {
  if (profile.backend === 'espeak-ng') {
    const backend = new EspeakBackend(profile);
    return { synthesize: (text) => backend.synthesize(text), probe: () => EspeakBackend.probe() };
  }
  if (profile.backend === 'kokoro') {
    const backend = new KokoroBackend(profile);
    return { synthesize: (text) => backend.synthesize(text), probe: () => backend.probe() };
  }
  throw new Error('unknown voice backend: ' + profile.backend);
}
