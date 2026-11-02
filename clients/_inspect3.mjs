import pkg from 'bilibili-live-ws';
const l = new pkg.LiveWS(23058);
console.log(Object.keys(l));
console.log(typeof l.connect, typeof l.start, typeof l.close);
process.exit(0);
