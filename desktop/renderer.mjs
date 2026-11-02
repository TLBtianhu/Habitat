// SVG Renderer v2：按 Habitat Desktop 设计令牌渲染（精致、克制、可读）
import { renderPixelSurface } from './backends/pixel.mjs';

const W = 1280;
const H = 720;
const C = {
  bg: '#0B0F14', surface: '#111827', raised: '#172033', border: '#243247',
  text: '#E6EDF7', sub: '#94A3B8', dim: '#64748B', accent: '#7C9EFF',
  good: '#34D399', warn: '#FBBF24', bad: '#FB7185',
};
const esc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

function mainRect() { return { x: 32, y: 56, w: 1216, h: 560 }; }
function pipRect(i) { return { x: 920, y: 76 + i * 168, w: 296, h: 150 }; }

function surfaceCard(s, r, main) {
  return `
  <g>
    <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="16" fill="${C.surface}" stroke="${C.border}"/>
    <text x="${r.x + 24}" y="${r.y + 38}" fill="${C.text}" font-size="22" font-weight="600" font-family="Inter,Noto Sans SC,sans-serif">${esc(s.appId)}</text>
    <text x="${r.x + 24}" y="${r.y + 64}" fill="${C.sub}" font-size="14" font-family="Inter,Noto Sans SC,sans-serif">${esc(s.kind)} · ${esc(s.state)}</text>
    ${s.view?.kind ? `<text x="${r.x + 24}" y="${r.y + 90}" fill="${C.accent}" font-size="13" font-family="Inter,Noto Sans SC,sans-serif">${esc(s.view.kind)}</text>` : ''}
    ${main ? `<rect x="${r.x + r.w - 112}" y="${r.y + 20}" width="88" height="28" rx="14" fill="${C.raised}"/><text x="${r.x + r.w - 96}" y="${r.y + 39}" fill="${C.sub}" font-size="12" font-family="Inter,Noto Sans SC,sans-serif">LIVE</text>` : ''}
    ${main ? renderPixelSurface(s.snapshot, { x: r.x + 24, y: r.y + 110, w: r.w - 48, h: r.h - 140 }) : ''}
  </g>`;
}

export function renderSvg(frame) {
  const parts = [];
  parts.push(`<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0D1420"/><stop offset="1" stop-color="${C.bg}"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000" flood-opacity=".28"/></filter>
  </defs>`);
  parts.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`);
  parts.push(`<text x="32" y="34" fill="${C.dim}" font-size="13" letter-spacing="2" font-family="Inter,Noto Sans SC,sans-serif">HABITAT DESKTOP</text>`);

  const mains = frame.surfaces.filter((s) => s.layout.space === 'full');
  for (const s of mains) parts.push(`<g filter="url(#shadow)">${surfaceCard(s, mainRect(), true)}</g>`);
  frame.surfaces.filter((s) => s.layout.space === 'pip').slice(0, 2).forEach((s, i) => {
    parts.push(surfaceCard(s, pipRect(i), false));
  });

  const items = (frame.taskbar || []).filter((t) => t.state !== 'closed');
  const pillW = 132;
  const gap = 12;
  const total = items.length * pillW + Math.max(0, items.length - 1) * gap + 32;
  const x0 = (W - total) / 2;
  const y = 644;
  parts.push(`<g filter="url(#shadow)"><rect x="${x0}" y="${y}" width="${total}" height="56" rx="18" fill="#111827" fill-opacity=".92" stroke="${C.border}"/></g>`);
  items.forEach((item, i) => {
    const x = x0 + 16 + i * (pillW + gap);
    const focused = item.state === 'focused';
    parts.push(`<rect x="${x}" y="${y + 10}" width="${pillW}" height="36" rx="12" fill="${focused ? C.accent : C.raised}" stroke="${focused ? C.accent : C.border}"/>`);
    parts.push(`<text x="${x + 14}" y="${y + 33}" fill="${focused ? '#0B0F14' : C.text}" font-size="14" font-weight="${focused ? 600 : 400}" font-family="Inter,Noto Sans SC,sans-serif">${esc(item.appId)}</text>`);
    if (item.badge) parts.push(`<circle cx="${x + pillW - 16}" cy="${y + 22}" r="4" fill="${C.warn}"/>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}
