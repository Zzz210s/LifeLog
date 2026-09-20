#!/usr/bin/env node
/**
 * 产物 chunk 的字节归因:按 sourcemap mappings 把每个生成字节算到源模块头上,
 * 用来回答「这个 200KB+ 的 chunk 里到底是什么」—— 只靠 chunk 名字会被 rollup 的命名规则误导
 * (共享 chunk 以块内某个源模块命名,与块的内容构成无关)。
 *
 * 前置:先出带 sourcemap 的产物,别覆盖 dist,也别放仓根(会被 tailwind 扫进 CSS):
 *   pnpm build --sourcemap --outDir .superpowers/dist-an
 * 用法:
 *   node scripts/chunk-attribution.mjs '.superpowers/dist-an/assets/input-settings-*.js' [--top=25]
 *
 * 算法:逐行解 mappings 的 VLQ,每个分段覆盖「本段生成列 -> 下一段生成列(行尾)」的字节区间,
 * 计到该段当前指向的源文件上;不统计换行符,故合计略小于文件字节数。
 */
import { globSync, readFileSync } from 'node:fs';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const IDX = new Map([...B64].map((c, i) => [c, i]));

/** base64 VLQ 段解码(返回增量数组:生成列/源索引/源行/源列) */
function decodeVlq(seg) {
  const out = [];
  let shift = 0;
  let value = 0;
  for (const ch of seg) {
    const d = IDX.get(ch);
    if (d === undefined) throw new Error(`非法 VLQ 字符: ${ch}`);
    const cont = d & 32;
    value += (d & 31) << shift;
    if (cont) {
      shift += 5;
      continue;
    }
    const neg = value & 1;
    value >>= 1;
    out.push(neg ? -value : value);
    value = 0;
    shift = 0;
  }
  return out;
}

const args = process.argv.slice(2);
const pattern = args.find((a) => !a.startsWith('--'));
const top = Number((args.find((a) => a.startsWith('--top=')) || '--top=25').slice(6));
if (!pattern) {
  console.error('用法: node scripts/chunk-attribution.mjs <chunk.js|glob> [--top=25]');
  process.exit(1);
}
const files = pattern.includes('*') ? globSync(pattern) : [pattern];
if (!files.length) {
  console.error(`未匹配到文件: ${pattern}`);
  process.exit(1);
}

for (const chunkPath of files) {
  const mapPath = `${chunkPath}.map`;
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  const code = readFileSync(chunkPath, 'utf8');
  const lines = code.split('\n');
  const attr = new Map();
  let srcIdx = 0;

  map.mappings.split(';').forEach((seg, genLine) => {
    if (!seg) return;
    const cols = [];
    let genCol = 0;
    for (const part of seg.split(',')) {
      const f = decodeVlq(part);
      genCol += f[0];
      if (f.length >= 4) srcIdx += f[1];
      cols.push({ col: genCol, src: map.sources[srcIdx] ?? '<unknown>' });
    }
    const lineLen = (lines[genLine] ?? '').length;
    cols.forEach((c, i) => {
      const end = i + 1 < cols.length ? cols[i + 1].col : lineLen;
      attr.set(c.src, (attr.get(c.src) ?? 0) + Math.max(0, end - c.col));
    });
  });

  const rows = [...attr.entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((a, [, v]) => a + v, 0);
  console.log(`\n=== ${chunkPath} (${code.length} 字节,已归因 ${total}) ===`);
  for (const [src, bytes] of rows.slice(0, top)) {
    console.log(`${String(bytes).padStart(8)}  ${(bytes / 1024).toFixed(1).padStart(8)}K  ${src}`);
  }
  if (rows.length > top) console.log(`... 其余 ${rows.length - top} 个源模块合计 ${rows.slice(top).reduce((a, [, v]) => a + v, 0)} 字节`);
}
