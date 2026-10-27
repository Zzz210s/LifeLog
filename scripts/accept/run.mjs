// 验收脚本运行器(架构精简 D,2026-10-27)。
//
//   pnpm accept                    跑所有非 write / 非 obsolete 的条目
//   pnpm accept --list             列出登记表(环境、判据、标记)
//   pnpm accept --only links       只跑名字含 links 的
//   pnpm accept --env app          只跑某一档环境(node / db / app / dev)
//   pnpm accept --include-write    连写库脚本一起跑(默认跳过)
//
// 设计取舍:超时即判失败并杀进程(脚本卡在等 CDP 时不能拖死整批);
// 需要参数的脚本判 SKIP 并打印用法(没有参数跑出来的"失败"不是回归);
// 每条打印 `结果 · 名字 · 秒数 · 环境`,结尾给汇总 + 非零退出码。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { SCRIPTS } from './registry.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const value = (n) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : null;
};

// --timeout 的单位是**秒**(默认 240s);写成毫秒会让整批被判超时
const TIMEOUT_MS = Number(value('timeout') ?? 240) * 1000;

function resolvePath(name) {
  const a = `scripts/${name}.mjs`;
  const b = `scripts/${name}`;
  return existsSync(b) ? b : a;
}

function runOne(entry) {
  return new Promise((resolve) => {
    const file = resolvePath(entry.name);
    if (!existsSync(file)) {
      resolve({ ...entry, ok: false, secs: 0, out: '脚本不存在: ' + file });
      return;
    }
    const started = Date.now();
    const child = spawn(process.execPath, [file], {
      env: {
        ...process.env,
        // 装机版默认 9222;要跑别的实例就设 LIFELOG_CDP_PORT
        LIFELOG_CDP_PORT: process.env.LIFELOG_CDP_PORT ?? '9222',
        LIFELOG_ACCEPT_RUNNER: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const cap = (buf) => {
      out += buf.toString();
      if (out.length > 4000) out = out.slice(-4000);
    };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      cap(Buffer.from('\n[runner] 超时,已终止'));
    }, TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ...entry, ok: code === 0, secs: Math.round((Date.now() - started) / 100) / 10, out });
    });
  });
}

function pickList() {
  const listing = flag('list');
  let list = SCRIPTS.slice();
  if (!flag('include-write')) list = list.filter((s) => !s.write);
  if (!flag('include-obsolete')) list = list.filter((s) => !s.obsolete);
  const only = value('only');
  if (only) list = list.filter((s) => s.name.includes(only));
  const env = value('env');
  if (env) list = list.filter((s) => s.env === env);
  return { list, listing };
}

function printList(list) {
  for (const s of list) {
    const tags = [s.env, s.write ? '写库' : '', s.obsolete ? '已废弃' : '', s.needsArgs ? '需参数' : '']
      .filter(Boolean)
      .join('/');
    console.log(`${s.name.padEnd(40)} ${tags.padEnd(20)} ${s.why}`);
  }
  console.log(`\n共 ${list.length} 条`);
}

async function main() {
  const { list, listing } = pickList();
  if (listing) {
    printList(list);
    return 0;
  }
  if (!list.length) {
    console.log('没有匹配的条目');
    return 0;
  }

  console.log(`跑 ${list.length} 条(超时 ${TIMEOUT_MS / 1000}s/条)\n`);
  const results = [];
  for (const entry of list) {
    // 必须带参数的脚本:没有参数跑出来的"失败"不是回归,判 SKIP 并打印用法
    if (entry.needsArgs) {
      console.log(`SKIP  ${entry.name.padEnd(40)}       -  ${entry.needsArgs}`);
      results.push({ ...entry, ok: true, skipped: true, secs: 0, out: '' });
      continue;
    }
    const r = await runOne(entry);
    results.push(r);
    // 已知陈旧:仍然跑,但判定 STALE(不算回归;`--strict` 时计入失败)
    const staleMark = entry.stale && !r.ok ? 'STALE' : null;
    r.staleHit = staleMark;
    const mark = staleMark ?? (r.ok ? 'PASS' : 'FAIL');
    console.log(`${mark}  ${r.name.padEnd(40)} ${String(r.secs).padStart(6)}s  ${r.env}`);
    if (!r.ok) console.log(r.out.split('\n').slice(-12).join('\n'));
  }

  const skipped = results.filter((r) => r.skipped).length;
  const staleHit = results.filter((r) => r.staleHit).length;
  const pass = results.filter((r) => r.ok && !r.skipped).length;
  const strict = flag('strict');
  const fail = results.length - pass - skipped - (strict ? 0 : staleHit);
  console.log('');
  console.log(
    `汇总:${pass} PASS / ${fail} FAIL / ${skipped} SKIP / ${staleHit} STALE / 共 ${results.length}` +
      (strict ? '(strict:STALE 计失败)' : '')
  );
  if (fail) {
    console.log('失败清单:');
    results.filter((r) => !r.ok).forEach((r) => console.log('  -', r.name));
  }
  return fail ? 1 : 0;
}

main().then((code) => process.exit(code));
