// Mock QR provider：开发/测试用，流程与真实扫码一致，但不碰真实账号
import QRCode from 'qrcode';

export async function begin() {
  const url = 'https://example.com/mock-qr-login';
  return {
    flow: 'qrcode',
    qrcodeKey: 'mock-qr-1',
    url,
    qrDataUrl: await QRCode.toDataURL(url),
    instruction: '测试：模拟扫码确认',
  };
}

let polls = 0;
export async function poll() {
  polls += 1;
  if (polls >= 2) return { status: 'bound', displayName: 'Mock 用户' };
  return { status: 'waiting', message: '等待扫码确认' };
}

export function writeConfig() {
  return { written: 'mock（不写真实配置）' };
}
