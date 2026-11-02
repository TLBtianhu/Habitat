import pkg from 'bilibili-live-ws';
const l = new pkg.LiveWS(23058);
console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(l)));
process.exit(0);
