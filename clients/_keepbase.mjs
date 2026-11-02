import pkg from 'bilibili-live-ws';
const proto = Object.getPrototypeOf(pkg.KeepLiveTCP);
console.log(proto.toString().slice(0, 3000));
process.exit(0);
