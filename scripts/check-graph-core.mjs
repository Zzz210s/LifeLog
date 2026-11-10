// graph-core 与 app 侧类型的漂移检查（P1 抽核阶段用「复制 + 校验」代替 monorepo 依赖）。
// 用法：node scripts/check-graph-core.mjs
import { readFileSync } from 'node:fs';

const pairs = [
  ['packages/graph-core/src/types/graph.ts', 'src/shared/graph-types.ts'],
];

const parseInterfaces = (src) => {
  const out = new Map();
  const re = /export interface (\w+) \{([\s\S]*?)\n\}/g;
  for (const m of src.matchAll(re)) {
    const fields = [...m[2].matchAll(/^ {2}(\w+)\s*[?]?:/gm)].map((x) => x[1]).sort();
    out.set(m[1], fields);
  }
  return out;
};

let bad = 0;
for (const [core, app] of pairs) {
  const ci = parseInterfaces(readFileSync(core, 'utf8'));
  const ai = parseInterfaces(readFileSync(app, 'utf8'));
  let diffs = 0;
  for (const [name, cf] of ci) {
    const af = ai.get(name);
    if (!af) continue;
    const missing = af.filter((f) => !cf.includes(f));
    if (missing.length > 0) {
      console.log(`漂移: ${name} 少字段 ${missing.join(', ')}（app 侧有）`);
      diffs += 1;
    }
  }
  if (diffs > 0) bad += 1;
  else console.log(`一致: ${core} 的 ${ci.size} 个接口与 app 侧同名接口字段相同`);
}
process.exit(bad === 0 ? 0 : 1);
