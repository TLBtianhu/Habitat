// 一键总验收：M2 / AgentLoop / M4 短验 / 健康总览
import { execFileSync } from 'node:child_process';

function run(file, args = []) {
  console.log('\n=== ' + file + ' ===');
  execFileSync('node', [file, ...args], { stdio: 'inherit' });
}

run('C:/Habitat/runtime/verify-m2.mjs');
run('C:/Habitat/agent/verify-agent.mjs');
run('C:/Habitat/runtime/verify-m4.mjs', ['--minutes', '1']);
run('C:/Habitat/tools/health-check.mjs');
console.log('\n全部验收通过');
