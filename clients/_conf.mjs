import pkg from 'bilibili-live-ws';
const c = await pkg.getConf(545068);
console.log(JSON.stringify(c, null, 2).slice(0, 1500));
process.exit(0);
