import pkg from 'bilibili-live-ws';
const { LiveTCPBase } = pkg;
console.log(LiveTCPBase.toString().slice(0, 2000));
process.exit(0);
