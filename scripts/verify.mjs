#!/usr/bin/env node
/**
 * 一键门禁(替代手打四门禁 + 行数红线):
 *   1) 类型检查   pnpm typecheck
 *   2) 前端单测   pnpm exec vitest run
 *   3) 前端构建   pnpm build                (--quick 跳过)
 *   4) Rust 单测  cargo test
 *   5) Rust 零告警 cargo check --lib
 *   6) Clippy     cargo clippy --lib --all-targets -- -D warnings   (--quick 跳过)
 *   7) 未用符号   tsc --noEmit --noUnusedLocals --noUnusedParameters
 *   8) 行数红线   代码文件 ≤200 行(.md 文档不受限)
 * 用法:pnpm verify / pnpm verify:quick;任一步失败即非零退出并打印输出尾部。
 */
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const quick = process.argv.includes('--quick');
const cwd = process.cwd();
const codeFiles = execSync('git ls-files', { cwd, encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(ts|tsx|js|mjs|cjs|rs|py|css|html)$/.test(f));

/**
 * 行数(与 wc -l 同口径:结尾换行不算新的一行;CRLF 不影响计数)。
 * 读不到(如 git 里已删、尚未提交)返回 null —— 这种瞬时状态不该让门禁崩在 ENOENT。
 */
function lineCount(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  return text.replace(/\n$/, '').split('\n').length;
}

/** 行数红线:代码文件 ≤200 行(.md 文档按用户规则不受限) */
function checkLineLimit() {
  const sizes = codeFiles
    .map((f) => [f, lineCount(f)])
    .filter(([, n]) => n !== null);
  const bad = sizes.filter(([, n]) => n > 200);
  if (bad.length) {
    console.error('行数超限(代码文件上限 200 行):');
    for (const [f, n] of bad) console.error(`  - ${f}: ${n} 行`);
    return false;
  }
  const max = Math.max(...sizes.map(([, n]) => n));
  console.log(`通过(${sizes.length} 个代码文件,最长 ${max} 行)`);
  return true;
}

const steps = [
  { name: '类型检查', cmd: 'pnpm typecheck' },
  { name: '前端单测', cmd: 'pnpm exec vitest run' },
  ...(quick ? [] : [{ name: '前端构建', cmd: 'pnpm build' }]),
  { name: 'Rust 单测', cmd: 'cargo test', dir: 'src-tauri' },
  { name: 'Rust 零告警', cmd: 'cargo check --lib', dir: 'src-tauri' },
  ...(quick
    ? []
    : [{ name: 'Clippy', cmd: 'cargo clippy --lib --all-targets -- -D warnings', dir: 'src-tauri' }]),
  { name: '未用符号', cmd: 'npx tsc --noEmit --noUnusedLocals --noUnusedParameters' },
];

let failed = 0;
const t0 = Date.now();
for (const s of steps) {
  const started = Date.now();
  process.stdout.write(`[门禁] ${s.name} ... `);
  const r = spawnSync(s.cmd, { cwd: s.dir ? `${cwd}/${s.dir}` : cwd, shell: true, encoding: 'utf8' });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (r.status === 0) {
    console.log(`通过 (${secs}s)`);
  } else {
    failed++;
    console.log(`失败 (${secs}s)`);
    const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim().split('\n');
    console.log(out.slice(-25).join('\n'));
  }
}

process.stdout.write('[门禁] 行数红线 ... ');
if (!checkLineLimit()) failed++;

const total = ((Date.now() - t0) / 1000).toFixed(1);
if (failed) {
  console.error(`\n门禁失败:${failed} 步未通过(共 ${total}s)`);
  process.exit(1);
}
console.log(`\n全部门禁通过(共 ${total}s)`);
