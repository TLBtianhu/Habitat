import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BilibiliRtmpOutput } from './outputs/bilibili-rtmp.mjs';

function fakeSpawn(argsSeen) {
  return (_command, args) => {
    argsSeen.push(args);
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.writable = true;
    child.stdin.write = () => true;
    child.stdin.end = () => child.emit('exit', 0);
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
}
const boundedArgs = [];
const bounded = new BilibiliRtmpOutput({ target: 'rtmp://127.0.0.1/live', streamKey: 'secret', spawnImpl: fakeSpawn(boundedArgs), audio: 'silent' });
await bounded.start();
await bounded.stop();
assert.ok(boundedArgs[0].includes('-maxrate') && boundedArgs[0].includes('3500k'));
assert.ok(boundedArgs[0].includes('-bufsize') && boundedArgs[0].includes('7000k'));
assert.deepEqual(bounded.status().rateControl, { mode: 'vbv', targetKbps: 3500, maxRateKbps: 3500, vbvBufferKbps: 7000 });

const abrArgs = [];
const abr = new BilibiliRtmpOutput({ target: 'rtmp://127.0.0.1/live', streamKey: 'secret', spawnImpl: fakeSpawn(abrArgs), audio: 'silent', rateControl: 'abr' });
await abr.start();
await abr.stop();
assert.ok(!abrArgs[0].includes('-maxrate') && !abrArgs[0].includes('-bufsize'));
assert.deepEqual(abr.status().rateControl, { mode: 'abr', targetKbps: 3500, maxRateKbps: null, vbvBufferKbps: null });
assert.throws(() => new BilibiliRtmpOutput({ target: 'rtmp://127.0.0.1/live', streamKey: 'secret', maxRateKbps: 2000 }), /maxRateKbps/);
assert.throws(() => new BilibiliRtmpOutput({ target: 'rtmp://127.0.0.1/live', streamKey: 'secret', vbvBufferKbps: 1000 }), /vbvBufferKbps/);
assert.throws(() => new BilibiliRtmpOutput({ target: 'rtmp://127.0.0.1/live', streamKey: 'secret', rateControl: 'cbr' }), /rateControl/);
console.log('ok: VBV 码率上限、缓冲上限、ABR 回滚与非法参数拒绝');
