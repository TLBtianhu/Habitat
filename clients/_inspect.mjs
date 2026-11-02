import pkg from 'bilibili-live-ws';
console.log(Object.keys(pkg));
console.log(typeof pkg.LiveDanmaku, pkg.LiveDanmaku?.toString().slice(0, 200));
process.exit(0);
