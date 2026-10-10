#!/usr/bin/env node
/**
 * 生成引用优化 A+C 的自包含对照预览 HTML(只读真库与两个副本)。
 * 三组真实对照:侧栏树(本级/含子级)、笔记卡片(chip 前后)、总账(计数+筛选/搜索示例)。
 * 样式沿用仓内令牌 src/shared/theme.css(--color-* / text-* / rounded-sm),亮暗可切。
 * 用法: node scripts/refs-preview-html.mjs --out <html>
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = { out: '' };
for (let i = 0; i < argv.length; i += 1) if (argv[i] === '--out') opt.out = argv[++i];
if (!opt.out) { console.error('用法: node scripts/refs-preview-html.mjs --out <html>'); process.exit(2); }

const REAL = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
const TMP = 'F:/tmp/lifelog-refs-preview';
const name = (m) => { for (const l of (m || '').split('\n')) if (l.trim()) return l.trim(); return ''; };
const add = (m, k, v) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };

function loadDb(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  const ents = new Map(db.prepare('SELECT id, meta, path, parent_id, depth FROM entities').all().map((r) => [r.id, r]));
  const links = db.prepare("SELECT source_id, target_id FROM edges WHERE kind='link'").all();
  // own / roll 与产品 tags::counts 同口径(COUNT(DISTINCT source_id),源可为笔记或标签)
  const own = new Map(), roll = new Map(), noteTags = new Map();
  const up = new Map();
  const chain = (id) => { let a = up.get(id); if (a) return a; a = []; let c = id; while (c != null) { a.push(c); c = ents.get(c).parent_id; } up.set(id, a); return a; };
  for (const l of links) {
    const s = ents.get(l.source_id), t = ents.get(l.target_id);
    if (s.path === null && t.path !== null) {
      if (!noteTags.has(s.id)) noteTags.set(s.id, []);
      noteTags.get(s.id).push(t.id);
    }
    if (t.path === null) continue;
    add(own, t.id, s.id);
    for (const a of chain(t.id)) add(roll, a, s.id);
  }
  const cnt = (sql) => db.prepare(sql).get().c;
  const e = [...ents.values()];
  return {
    ents, own, roll, noteTags,
    chips: (id) => (noteTags.get(id) || []).map((t) => ents.get(t).path).sort(),
    counts: {
      entities: e.length,
      tree: e.filter((x) => x.path !== null).length,
      notes: e.filter((x) => x.path === null).length,
      is_cited: cnt('SELECT COUNT(*) c FROM entities WHERE is_cited = 1'),
      fts: cnt('SELECT COUNT(*) c FROM entities_fts'),
      aliases: cnt('SELECT COUNT(*) c FROM entity_aliases'),
      edges: cnt('SELECT COUNT(*) c FROM edges'),
      child: cnt("SELECT COUNT(*) c FROM edges WHERE kind='child'"),
      link: cnt("SELECT COUNT(*) c FROM edges WHERE kind='link'"),
      linkNoteTag: cnt("SELECT COUNT(*) c FROM edges l JOIN entities s ON s.id=l.source_id JOIN entities t ON t.id=l.target_id WHERE l.kind='link' AND s.path IS NULL AND t.path IS NOT NULL"),
      linkTagTag: cnt("SELECT COUNT(*) c FROM edges l JOIN entities s ON s.id=l.source_id JOIN entities t ON t.id=l.target_id WHERE l.kind='link' AND s.path IS NOT NULL AND t.path IS NOT NULL"),
    },
  };
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const B = loadDb(REAL), A = loadDb(`${TMP}/after-A.db`), D = loadDb(`${TMP}/after-D.db`);
const jsonB = JSON.parse(readFileSync(`${TMP}/before.json`, 'utf8'));
const jsonA = JSON.parse(readFileSync(`${TMP}/after-A.json`, 'utf8'));
const jsonD = JSON.parse(readFileSync(`${TMP}/after-D.json`, 'utf8'));

// ---- 组 1:侧栏树 本级/含子级 ----
const stat = (db, id) => ({
  d: db.own.get(id)?.size ?? 0,
  c: db.roll.get(id)?.size ?? 0,
});
const treeRows = [];
for (const e of B.ents.values()) {
  if (e.path === null) continue;
  const b = stat(B, e.id), a = stat(A, e.id), d = stat(D, e.id);
  const delta = Math.max(Math.abs(a.d - b.d), Math.abs(a.c - b.c), Math.abs(d.d - b.d), Math.abs(d.c - b.c));
  if (delta > 0) treeRows.push({ path: e.path, b, a, d, delta });
}
treeRows.sort((x, y) => y.delta - x.delta);
const LANDMARK = ['地点轴/所在', '状态/已完成', '待办', '待办/银行', '电影/真人', '旅游/餐厅',
  '知识', '科幻', '游戏/知识', '游戏/科幻', '地点/中国大陆', '旅游/人文'];
const treeTop = treeRows.slice(0, 36);
for (const p of LANDMARK) {
  const r = treeRows.find((x) => x.path === p);
  if (r && !treeTop.includes(r)) treeTop.push(r);
}

// ---- 组 2:笔记卡片 ----
const NOTE_IDS = [236, 1272, 1233, 278, 1373];
const notes = NOTE_IDS.map((id) => {
  const e = B.ents.get(id);
  const chips = (db) => { const m = new Map(); for (const x of new Set(db.chips(id))) m.set(x, true); return [...m.keys()]; };
  const b = chips(B), a = chips(A), d = chips(D);
  const diff = (x, y) => ({ gone: [...new Set(x)].filter((v) => !y.includes(v)), added: y.filter((v) => !x.includes(v)) });
  return { id, name: name(e.meta), b, a, d, da: diff(b, a), dd: diff(b, d) };
});

// ---- 组 3:总账 + 示例 ----
const KEYS = ['entities', 'tree', 'notes', 'is_cited', 'fts', 'aliases', 'edges', 'child', 'link', 'linkNoteTag', 'linkTagTag'];
const TOT_LABEL = { entities: '实体 entities', tree: '树内(path 非空)', notes: '笔记(path 空)', is_cited: 'is_cited=1', fts: 'entities_fts 行', aliases: 'entity_aliases', edges: 'edges 总数', child: 'edges child', link: 'edges link', linkNoteTag: 'link 笔记->标签', linkTagTag: 'link 标签->标签' };
const CHOOSE_KW = [1, 2, 5, 7, 9, 10, 11, 14];
const CHOOSE_FILTER = [0, 1, 2, 3, 4, 7, 8, 10, 12, 16];

const css = `:root{--color-canvas:#f6f6f7;--color-chrome:#fff;--color-chrome-alt:#ececee;--color-raised:#fff;--color-border:#e3e5e8;--color-border-strong:#cfd4d9;--color-text:#1f2328;--color-muted:#5e666f;--color-faint:#7e868f;--color-accent:#2563eb;--color-accent-text:#1d4ed8;--color-accent-soft:#e8f1fd;--color-danger:#dc2626;--color-danger-soft:#fef2f2;--color-success:#16a34a;--color-warn:#b45309;--color-warn-soft:#fffbeb;--radius-xs:4px;--radius-sm:6px;--radius-md:8px;--radius-lg:12px;--shadow-sm:0 1px 2px rgb(0 0 0 / 6%);--shadow-md:0 4px 12px rgb(0 0 0 / 10%)}
.dark{--color-canvas:#1e1e1e;--color-chrome:#252526;--color-chrome-alt:#2d2d30;--color-raised:#252526;--color-border:#3c3c3c;--color-border-strong:#4a4a4a;--color-text:#ccc;--color-muted:#9d9d9d;--color-faint:#7a7a7a;--color-accent:#007acc;--color-accent-text:#60caff;--color-accent-soft:#264f78;--color-danger:#f48771;--color-danger-soft:#4b2a2a;--color-success:#89d185;--color-warn:#cca700;--color-warn-soft:#3a3520;--shadow-sm:0 1px 2px rgb(0 0 0 / 24%);--shadow-md:0 4px 12px rgb(0 0 0 / 30%)}
*{box-sizing:border-box}body{margin:0;background:var(--color-canvas);color:var(--color-text);font:15px/26px -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:20px;line-height:28px;font-weight:600;margin:0 0 4px}h2{font-size:16px;line-height:24px;font-weight:600;margin:32px 0 8px}
.text-label{font-size:12px;line-height:16px}.text-ui{font-size:13px;line-height:18px}.text-body-sm{font-size:14px;line-height:22px}
.muted{color:var(--color-muted)}.faint{color:var(--color-faint)}
.card{background:var(--color-raised);border:1px solid var(--color-border);border-radius:var(--radius-md);box-shadow:var(--shadow-sm)}
.bar{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;justify-content:space-between}
button{font:inherit;color:var(--color-text);background:var(--color-raised);border:1px solid var(--color-border-strong);border-radius:var(--radius-sm);padding:4px 10px;cursor:pointer}
button:hover{background:var(--color-chrome-alt)}
table{border-collapse:collapse;width:100%;background:var(--color-raised)}
th,td{border:1px solid var(--color-border);padding:5px 8px;text-align:left;vertical-align:top}
th{background:var(--color-chrome-alt);font-weight:600;font-size:12px;line-height:16px;position:sticky;top:0}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tr.changed td:first-child{border-left:3px solid var(--color-accent)}
.gone{color:var(--color-danger)}.add{color:var(--color-success)}
.chip{display:inline-block;background:var(--color-chrome-alt);border:1px solid var(--color-border);border-radius:var(--radius-xs);padding:0 6px;margin:2px 4px 2px 0;font-size:12px;line-height:18px}
.chip.gone{background:var(--color-danger-soft);border-color:var(--color-danger);color:var(--color-danger);text-decoration:line-through}
.chip.add{background:var(--color-warn-soft);border-color:var(--color-warn);color:var(--color-warn)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}
.pad{padding:12px}.tblwrap{overflow:auto;max-height:620px;border:1px solid var(--color-border);border-radius:var(--radius-md)}
.tot td:first-child{font-size:13px}.legend span{margin-right:14px}
`;

const dm = (b, v) => { const d = v - b; return d === 0 ? '<span class="faint">=</span>' : `<span class="${d < 0 ? 'gone' : 'add'}">${d > 0 ? '+' : ''}${d}</span>`; };
const cellD = (b, x, y, cls = 'num') => `<td class="${cls}">${b} <span class="faint">&rarr;</span> ${x} <span class="faint">&rarr;</span> ${y} <span class="muted">(A ${dm(b, x)} / D ${dm(b, y)})</span></td>`;

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>引用优化 A+C 前后对照预览</title><style>${css}</style></head><body><div class="wrap">
<div class="bar"><div>
<h1>引用优化 A+C 前后对照预览</h1>
<div class="text-body-sm muted">数据来源:真库只读快照 + 两个副本实测(A=祖先口径,D=字面口径)。本页不改库、仅供决策。</div>
</div><button id="theme">切换亮/暗</button></div>

<h2>一、侧栏树:本级 / 含子级(变动最大的 ${treeTop.length} 行)</h2>
<div class="text-ui muted legend"><span>本级 = 直接挂该标签的去重引用源数（产品 tags::counts 口径，源可为笔记或标签）</span><span>含子级 = 该标签及其后代上的去重引用源数</span><span class="gone">红=减少</span><span class="add">黄=增加</span></div>
<div class="tblwrap"><table>
<thead><tr><th>标签路径</th><th>A 本级 (before &rarr; A &rarr; D)</th><th>含子级 (before &rarr; A &rarr; D)</th></tr></thead>
<tbody>${treeTop.map((r) => `<tr class="changed"><td>${esc(r.path)}</td>${cellD(r.b.d, r.a.d, r.d.d)}${cellD(r.b.c, r.a.c, r.d.c)}</tr>`).join('')}</tbody>
</table></div>

<h2>二、笔记卡片:优化前带哪些 chip &rarr; 优化后带哪些 chip</h2>
<div class="grid">${notes.map((n) => `<div class="card pad">
<div class="text-label faint">#${n.id} · ${esc(n.name).slice(0, 46)}</div>
<div class="text-label muted" style="margin-top:8px">优化前 (${n.b.length})</div>
<div>${n.b.map((c) => `<span class="chip${n.da.gone.includes(c) ? ' gone' : ''}">${esc(c)}</span>`).join('')}</div>
<div class="text-label muted" style="margin-top:6px">A 祖先口径后 (${n.a.length})${n.da.added.length ? ` · 新增 ${n.da.added.map(esc).join('、')}` : ''}</div>
<div>${n.a.map((c) => `<span class="chip${n.da.added.includes(c) ? ' add' : ''}">${esc(c)}</span>`).join('') || '<span class="faint text-ui">(无)</span>'}</div>
<div class="text-label muted" style="margin-top:6px">D 字面口径后 (${n.d.length})${n.dd.gone.length ? ` · 比优化前少 ${n.dd.gone.map(esc).join('、')}` : ''}</div>
<div>${n.d.map((c) => `<span class="chip${n.dd.added.includes(c) ? ' add' : ''}">${esc(c)}</span>`).join('') || '<span class="faint text-ui">(无)</span>'}</div>
</div>`).join('')}</div>

<h2>三、总账:边数 / 树节点 / FTS 行数</h2>
<div class="card pad"><table class="tot"><thead><tr><th>读数</th><th class="num">优化前</th><th class="num">A 祖先口径</th><th class="num">D 字面口径</th></tr></thead><tbody>
${KEYS.map((k) => `<tr><td>${esc(TOT_LABEL[k])}</td><td class="num">${B.counts[k]}</td><td class="num">${A.counts[k]}</td><td class="num">${D.counts[k]}</td></tr>`).join('')}
</tbody></table></div>

<h2>四、筛选与搜索命中示例(同一谓词复刻)</h2>
<div class="card pad"><table><thead><tr><th>关键词搜索</th><th class="num">优化前</th><th class="num">A</th><th class="num">D</th><th>模式</th></tr></thead><tbody>
${CHOOSE_KW.map((i) => `<tr><td>${esc(jsonB.keywords[i].k)}</td>${cellD(jsonB.keywords[i].hits, jsonA.keywords[i].hits, jsonD.keywords[i].hits)}<td class="text-label faint">${jsonB.keywords[i].mode}</td></tr>`).join('')}
</tbody></table>
<table style="margin-top:12px"><thead><tr><th>筛选条件</th><th class="num">优化前</th><th class="num">A</th><th class="num">D</th></tr></thead><tbody>
${CHOOSE_FILTER.map((i) => `<tr><td>${esc(jsonB.filters[i].label)}</td>${cellD(jsonB.filters[i].hits, jsonA.filters[i].hits, jsonD.filters[i].hits)}</tr>`).join('')}
</tbody></table></div>

<h2>读法</h2>
<div class="text-body-sm muted">
<p>A(祖先口径,研究笔记建议)笔记筛选命中零丢失,代价是 7 个框架标签失去 is_cited、搜索(FTS)少 131 条地点结果;<br>
D(字面口径)把深层标签打穿:待办/银行 183&rarr;0、电影/真人 165&rarr;0、旅游/餐厅 85&rarr;0,不可接受。<br>
搜索列出现红色 = 关键词召回下降,是 A 必须配套解决的问题(carry 未并入 FTS);新增黄色 = A3 别名放大的召回。</p>
<p>注意两套数字不是同一口径:侧栏「含子级」是树计数(A 后 地点轴/所在 414&rarr;283),条件栏「含子级」筛选靠 carry 仍然命中(A 后 414&rarr;424)。<br>
所以侧栏会看到计数下降,而信息流筛选结果不变 —— 这就是 C 把直链提升为标签间关系后的预期表现。</p>
<p class="faint">生成:scripts/refs-preview-html.mjs(只读)。真库快照 sha256 11704c5b9a65b598... · after-A sha256 971136e6ea6b6a78... · after-D sha256 82fb67b06ecc204c...</p>
</div>
</div>
<script>
var b=document.getElementById('theme');
if(localStorage.getItem('refs-preview-theme')==='dark')document.documentElement.classList.add('dark');
b.addEventListener('click',function(){var d=document.documentElement.classList.toggle('dark');localStorage.setItem('refs-preview-theme',d?'dark':'light');});
</script></body></html>`;
writeFileSync(opt.out, html, 'utf8');
console.log(`树行 ${treeTop.length} / 卡片 ${notes.length} / 总账 ${KEYS.length} 行 -> ${opt.out}`);
console.log(`字节 ${Buffer.byteLength(html, 'utf8')}`);
