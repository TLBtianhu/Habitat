// pixel backend：客户端自己声明像素，Desktop 只负责把像素面合成进桌面
import fs from 'node:fs';

function toDataUrl(frame) {
  if (!frame) return null;
  if (frame.dataUrl) return frame.dataUrl;
  if (frame.path && fs.existsSync(frame.path)) {
    const b = fs.readFileSync(frame.path);
    return `data:image/jpeg;base64,${b.toString('base64')}`;
  }
  if (frame.url) return frame.url;
  return null;
}

export function renderPixelSurface(snapshot, { x, y, w, h }) {
  const href = toDataUrl(snapshot?.frame || snapshot?.pixel || null);
  if (!href) return '';
  return `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" href="${href}"/>`;
}
