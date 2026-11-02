/**
 * WORLD 场景渲染器（2.5D 俯视）：吃 /world 快照，画一张体素沙盘。
 * 渲染在出口（宿主浏览器），Worker 只出状态。
 */

const COLOR = {
  leaves: '#3f7a3a', log: '#6b4a2b', plank: '#8a6236', wood: '#6b4a2b',
  grass: '#4f8f45', dirt: '#6b5136', stone: '#6f7378', cobble: '#5f6368',
  deepslate: '#3a3d42', sand: '#c8b678', gravel: '#7a7568',
  water: '#2f5f9e', lava: '#c4502a', snow: '#dfe6ef', ice: '#9fc7e8',
  ore: '#8f8f9a', coal: '#3b3b40', iron: '#b08a6a', gold: '#c9a54a',
  diamond: '#4fc9c0', redstone: '#a33', emerald: '#3fa06a',
  flower: '#d06a8a', mushroom: '#a05a4a', glass: '#9fb0c0',
  default: '#4a5568',
};

function colorOf(name) {
  if (!name) return COLOR.default;
  for (const k of Object.keys(COLOR)) if (name.includes(k)) return COLOR[k];
  return COLOR.default;
}

const W = 1160;
const H = 652;

export function start(canvas) {
  const ctx = canvas.getContext('2d');
  let last = null;
  let stop = false;
  canvas.width = W; canvas.height = H;

  async function pull() {
    if (stop) return;
    try {
      const r = await fetch('http://127.0.0.1:9225/world');
      if (r.ok) last = await r.json();
    } catch {}
    draw();
    setTimeout(pull, 500);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0f18');
    g.addColorStop(1, '#070a10');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (!last || !last.heights) {
      ctx.fillStyle = '#6b7897';
      ctx.font = '28px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('等待世界数据…', W / 2, H / 2);
      return;
    }

    const { size, heights, nameIdx, palette, bot, entities, center } = last;
    const cell = Math.min(W, H) / size;
    const ox = (W - cell * size) / 2;
    const oy = (H - cell * size) / 2;
    const minH = Math.min(...heights.filter((h) => h > 0));
    const maxH = Math.max(...heights);
    const span = Math.max(1, maxH - minH);

    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const i = z * size + x;
        const h = heights[i];
        if (h < 0) continue; // 空列
        const px = ox + x * cell;
        const py = oy + z * cell;

        const base = colorOf(palette[(nameIdx[i] || 1) - 1]);
        const t = (h - minH) / span;
        const shade = 0.8 + t * 0.5;
        const lift = Math.round((h - minH) * 1.8);
        // 侧面
        ctx.fillStyle = shadeColor(base, shade * 0.6);
        ctx.fillRect(px, py + cell * 0.5 - lift, cell, cell * 0.5);
        // 顶面
        ctx.fillStyle = shadeColor(base, shade);
        ctx.fillRect(px, py - lift, cell, cell * 0.5);
      }
    }

    // 网格淡淡的
    ctx.strokeStyle = 'rgba(120,160,220,.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= size; i += 4) {
      const p = i * cell;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size * cell); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size * cell, p); ctx.stroke();
    }

    // 实体
    for (const e of entities || []) {
      const dx = e.pos[0] - center[0];
      const dz = e.pos[2] - center[2];
      const gx = ox + (dx + size / 2) * cell;
      const gy = oy + (dz + size / 2) * cell;
      ctx.beginPath();
      ctx.arc(gx, gy, Math.max(4, cell * 0.28), 0, Math.PI * 2);
      ctx.fillStyle = e.type === 'creeper' ? '#4caf50' : e.type === 'zombie' ? '#7cb342' : '#e06c75';
      ctx.fill();
      ctx.fillStyle = 'rgba(230,238,255,.75)';
      ctx.font = '14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(e.type, gx, gy - cell * 0.45);
    }

    // 她
    if (bot) {
      const dx = bot.pos[0] - center[0];
      const dz = bot.pos[2] - center[2];
      const gx = ox + (dx + size / 2) * cell;
      const gy = oy + (dz + size / 2) * cell;
      ctx.beginPath();
      ctx.arc(gx, gy, Math.max(6, cell * 0.42), 0, Math.PI * 2);
      ctx.fillStyle = '#6ea8ff';
      ctx.shadowColor = '#6ea8ff';
      ctx.shadowBlur = 24;
      ctx.fill();
      ctx.shadowBlur = 0;
      // 朝向
      const yaw = bot.yaw || 0;
      ctx.strokeStyle = '#dbe8ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + Math.sin(-yaw) * cell * 1.6, gy + Math.cos(-yaw) * cell * 1.6);
      ctx.stroke();
    }

    // 角标
    ctx.fillStyle = 'rgba(207,216,239,.55)';
    ctx.font = '16px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(`world ${size}×${size} · 中心 ${center.join(',')}`, 18, H - 18);
  }

  function shadeColor(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
    const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
    const b = Math.min(255, Math.round((n & 255) * k));
    return `rgb(${r},${g},${b})`;
  }

  pull();
  return { stop() { stop = true; } };
}
