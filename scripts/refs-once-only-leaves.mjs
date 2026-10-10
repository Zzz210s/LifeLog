#!/usr/bin/env node
/**
 * 生成「只被 1 篇笔记引用的树内叶子」D 清单 CSV(只读真库)。
 *
 * 数据源定义(与任务书 449 一致):
 *   树内  = entities.path IS NOT NULL
 *   被笔记引用 = 有一条 edges(kind='link') 入边,源实体 path IS NULL
 *   只被 1 篇 = 不同源笔记数 == 1  (实测全树 449 个,其中 10 个还有子标签)
 *
 * 启发式规则(按优先级,首个命中者写入「触发规则」列),详见报告:
 *   R1 数值索引标签   名字是纯数字/日期 -> 像真实分类 / 保留
 *   R2 专名分类轴     根轴=地点|作者       -> 像真实分类 / 保留
 *   R3 描述性自由文本 名字以「类」开头/含口语情绪词/含句读标点 -> 像自由文本 / 降级为正文
 *   R4 抄笔记首行     名字(>=3 字)出现在引用笔记首行 -> 像自由文本 / 降级为正文
 *   R5 成体系分类轴   同父 >=3 兄弟且被多篇引用比例 >=50% -> 像真实分类 / 保留
 *   R6 属性取值轴     根轴=预约|渠道|平台,或名字=未读 -> 像真实分类 / 提升为关系
 *   R7 同名重复       有意义的名字在别处还有同名树内实体 -> 像真实分类 / 合并到 <目标>
 *   R8 兜底           其余 -> 不确定 / 保留(待人工确认)
 * 用法: node scripts/refs-once-only-leaves.mjs --db <真库> --out <csv>
 */
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = { db: '', out: '' };
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--db') opt.db = argv[++i];
  else if (argv[i] === '--out') opt.out = argv[++i];
  else throw new Error(`未知参数: ${argv[i]}`);
}
if (!opt.db || !opt.out) {
  console.error('用法: node scripts/refs-once-only-leaves.mjs --db <真库> --out <csv>');
  process.exit(2);
}
const db = new DatabaseSync(opt.db, { readOnly: true });
const all = (sql, ...a) => db.prepare(sql).all(...a);

const firstLine = (meta) => {
  for (const l of (meta || '').split('\n')) if (l.trim()) return l.trim();
  return '';
};
const ents = new Map(all('SELECT id, meta, path, parent_id, depth FROM entities').map((r) => [r.id, r]));
const noteOf = (id) => ents.get(id);
const links = all("SELECT source_id, target_id FROM edges WHERE kind = 'link'");
const inl = new Map();
for (const l of links) {
  if (!inl.has(l.target_id)) inl.set(l.target_id, []);
  inl.get(l.target_id).push(l.source_id);
}
const kids = new Map();
for (const e of ents.values()) {
  if (e.parent_id != null) {
    if (!kids.has(e.parent_id)) kids.set(e.parent_id, []);
    kids.get(e.parent_id).push(e.id);
  }
}
const NUMERIC = /^\d{1,4}$/;
const DATELIKE = /^\d{4}[-/.]\d{1,2}([-/.]\d{1,2})?$/;
const COLLOQ = /哈哈|啦|吧|呢|呜|啊啊|太|真|好可|诶|呀|哦|嘛|咱|俺|喵|qwq|orz|QAQ|233|烧脑|好玩|无聊|好难|太难|硬核|治愈/i;
const PUNC = /[,;。！？；、：“”‘’()\[\].!?:;'"～~—]/;
const VALUE_AXIS = new Set(['预约', '渠道', '平台']);

const targets = [...ents.values()]
  .filter((e) => e.path !== null && (inl.get(e.id) || []).length === 1)
  .map((e) => ({ ...e, name: firstLine(e.meta), srcId: inl.get(e.id)[0] }));

// 有意义的名字 -> 全库同名树内实体(用于 R7)
const meaningfulName = (n) => n.length >= 2 && !NUMERIC.test(n) && !DATELIKE.test(n);
const sameName = new Map();
for (const e of ents.values()) {
  if (e.path === null) continue;
  const n = firstLine(e.meta);
  if (!meaningfulName(n)) continue;
  if (!sameName.has(n)) sameName.set(n, []);
  sameName.get(n).push(e);
}

const classify = (t) => {
  const root = t.path.split('/')[0];
  const nb = t.srcId != null ? firstLine(noteOf(t.srcId).meta) : '';
  const sibs = (kids.get(t.parent_id) || []).map((id) => ents.get(id));
  const cited = sibs.map((s) => (inl.get(s.id) || []).length);
  const multi = cited.filter((c) => c >= 2).length;
  if (NUMERIC.test(t.name) || DATELIKE.test(t.name)) return ['像真实分类', '保留', 'R1 数值索引标签'];
  if (root === '地点' || root === '作者') return ['像真实分类', '保留', 'R2 专名分类轴'];
  if (/^类/.test(t.name) || COLLOQ.test(t.name) || PUNC.test(t.name)) {
    return ['像自由文本', '降级为正文', 'R3 描述性自由文本'];
  }
  if (t.name.length >= 3 && nb.includes(t.name)) return ['像自由文本', '降级为正文', 'R4 抄笔记首行'];
  if (sibs.length >= 3 && multi / sibs.length >= 0.5) return ['像真实分类', '保留', 'R5 成体系分类轴'];
  if (VALUE_AXIS.has(root) || t.name === '未读') return ['像真实分类', '提升为关系', 'R6 属性取值轴'];
  if (meaningfulName(t.name)) {
    const other = (sameName.get(t.name) || []).filter((e) => e.id !== t.id);
    if (other.length) {
      const tgt = other.slice().sort((a, b) => (inl.get(b.id) || []).length - (inl.get(a.id) || []).length)[0];
      return ['像真实分类', `合并到 ${tgt.path}`, 'R7 同名重复'];
    }
  }
  return ['不确定', '保留(待确认)', 'R8 兜底'];
};

const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
// 零 emoji 规则:引用笔记首行可能含 emoji(如 #206),导出时剔除(不改变可识别性)
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;
const clean = (s) => String(s ?? '').replace(EMOJI, '');
const header = ['路径', '被引用笔记数', '所属根轴', 'depth', '引它的笔记首行(最多2条)',
  '启发式判断', '建议', '触发规则'];
const rows = targets
  .sort((a, b) => a.path.localeCompare(b.path, 'zh'))
  .map((t) => {
    const [judge, advice, rule] = classify(t);
    const nb = firstLine(noteOf(t.srcId).meta);
    return [t.path, 1, t.path.split('/')[0], t.depth, clean(nb), judge, advice, rule];
  });
let emojiStripped = 0;
for (const t of targets) if (EMOJI.test(firstLine(noteOf(t.srcId).meta))) emojiStripped += 1;
const csv = '\ufeff' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n';
writeFileSync(opt.out, csv, 'utf8');

const tally = {};
for (const r of rows) {
  const key = `${r[7]}\t${r[5]}\t${r[6]}`;
  tally[key] = (tally[key] || 0) + 1;
}
console.log(`行数 ${rows.length} -> ${opt.out}（剔除 emoji 的引用笔记首行 ${emojiStripped} 条）`);
for (const [k, n] of Object.entries(tally)) console.log(`  ${k}\t${n}`);
