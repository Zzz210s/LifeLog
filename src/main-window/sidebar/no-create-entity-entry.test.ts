/**
 * 入口处置表钉住用例(spec §5.3 / 计划 Task 3.3):不存在任何「新建标签 / 新建实体」入口。
 * 现状核实:本就不存在(命令层无 `create_tag` / `create_entity`),用例钉住不回归 ——
 * 进树只有两条路:「被引用」(正文 `#X` / `[[X]]` 解析漏斗自动建)与「拖进树」(T1.4 补 `link`)。
 * 扫源码,不扫测试(本文件自身含这些词)与文档。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['src', 'src-tauri/src/commands'];
const FORBIDDEN = ['create_tag', 'create_entity', '新建标签', '新建实体'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|rs)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('入口处置表:没有「新建标签 / 新建实体」入口', () => {
  it('源码里不存在 create_tag / create_entity 命令与「新建标签 / 新建实体」字样', () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const text = readFileSync(file, 'utf8');
        for (const needle of FORBIDDEN) {
          if (text.includes(needle)) offenders.push(`${file}: ${needle}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
