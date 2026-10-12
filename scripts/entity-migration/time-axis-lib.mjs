/** 时间轴收敛只读读数与等价性比对器（设计 2026-10-12 §5/§10、计划 T3+T5）。
 *  S1(树收敛) 与 S2(created_at 修复) 共用同一份只读快照；读库走 python sqlite3 的 mode=ro
 *  （本目录既有模式，见 reconcile-lib.mjs / snapshot.mjs），调用方不得传可写句柄。
 *  只做读数与比对，不写库、不打印（打印归 readout / verify）。 */
import { execFileSync } from 'node:child_process';

const PY = `
import json, sqlite3, sys, datetime
path = sys.argv[1].replace(chr(92), '/')
c = sqlite3.connect('file:' + path + '?mode=ro', uri=True)
NOTE = ("p.path IS NULL AND p.id <> 0 AND NOT EXISTS "
        "(SELECT 1 FROM lines n WHERE n.name_id = p.id)")
DAY = ("(t.path GLOB '时间/[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9]' "
       "OR t.path GLOB '时间/日期/[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9]')")
TREE = ("WITH RECURSIVE c(id) AS (SELECT id FROM points WHERE is_cited = 1 "
        "UNION SELECT l.from_id FROM lines l JOIN c ON c.id = l.to_id WHERE l.name_id = 0)")
CLOSURE = TREE + " SELECT COUNT(*) FROM c"
FEED = (TREE + " SELECT COUNT(*) FROM points p WHERE p.id <> 0 "
        "AND NOT (EXISTS(SELECT 1 FROM lines nl WHERE nl.name_id = p.id) "
        "AND NOT EXISTS(SELECT 1 FROM lines tl WHERE tl.from_id = p.id OR tl.to_id = p.id)) "
        "AND NOT (p.id IN (SELECT id FROM c) AND instr(p.meta, char(10)) = 0)")
FEED_IDS = FEED.replace("SELECT COUNT(*) FROM points p", "SELECT p.id FROM points p") + " ORDER BY 1"
TIME_NODES = "SELECT COUNT(*) FROM points WHERE path = '时间' OR path LIKE '时间/%'"
TIME_EDGES = ("SELECT COUNT(*) FROM lines WHERE name_id = 0 AND to_id IN "
              "(SELECT id FROM points WHERE path = '时间' OR path LIKE '时间/%')")
POINTS_SIG = ("SELECT group_concat(id || '|' || meta || '|' || COALESCE(path,'-') || '|' || "
              "COALESCE(parent_id,-1) || '|' || is_cited || '|' || COALESCE(depth,-1) || '|' || sort_order, char(10)) "
              "FROM (SELECT * FROM points ORDER BY id)")
LINES_SIG = ("SELECT group_concat(from_id || '|' || to_id || '|' || COALESCE(name_id,-1), char(10)) "
             "FROM (SELECT * FROM lines ORDER BY from_id, to_id, COALESCE(name_id,-1))")
FTS_SIG = "SELECT group_concat(rowid || ':' || paths, char(10)) FROM (SELECT rowid, paths FROM points_fts ORDER BY rowid)"
SETTINGS_SIG = "SELECT group_concat(key || '=' || value, char(10)) FROM (SELECT * FROM settings ORDER BY key)"
one = lambda s: c.execute(s).fetchone()[0]
sig = lambda s: c.execute(s).fetchone()[0] or ''
def day_of(p):
    parts = p.rsplit('/', 3)[-3:]
    if len(parts) != 3: return None
    y, m, d = parts
    if len(y) != 4 or len(m) != 2 or len(d) != 2: return None
    try: datetime.date(int(y), int(m), int(d))
    except Exception: return None
    return y + '-' + m + '-' + d
notes = dict(c.execute('SELECT id, created_at FROM points p WHERE ' + NOTE))
tag_rows = list(c.execute("SELECT p.id, t.path FROM points p "
    "JOIN lines e ON e.from_id = p.id AND (e.name_id IS NULL OR e.name_id <> 0) "
    "JOIN points t ON t.id = e.to_id WHERE " + NOTE + " ORDER BY p.id, t.path"))
note_tags = {}
for pid, p in tag_rows: note_tags.setdefault(str(pid), []).append(p)
day_tags = {}
for pid, p in c.execute("SELECT p.id, t.path FROM points p "
        "JOIN lines e ON e.from_id = p.id AND (e.name_id IS NULL OR e.name_id <> 0) "
        "JOIN points t ON t.id = e.to_id WHERE " + NOTE + " AND " + DAY + " ORDER BY p.id, t.path"):
    day_tags.setdefault(str(pid), []).append(p)
days, multi, bad = {}, {}, []
for pid, ps in day_tags.items():
    parsed = [day_of(t) for t in ps]
    if any(x is None for x in parsed):
        bad.append({'id': int(pid), 'paths': ps}); continue
    uniq = sorted(set(parsed))
    days[pid] = uniq[0]
    if len(uniq) > 1: multi[pid] = uniq
out = {
  'db': path,
  'readings': {
    'points': one('SELECT COUNT(*) FROM points'), 'lines': one('SELECT COUNT(*) FROM lines'),
    'fts': one('SELECT COUNT(*) FROM points_fts'),
    'tree': one('SELECT COUNT(*) FROM points WHERE path IS NOT NULL'),
    'closure': one(CLOSURE), 'cited': one('SELECT COUNT(*) FROM points WHERE is_cited = 1'),
    'feed': one(FEED), 'merge_log': one('SELECT COUNT(*) FROM entity_merge_log'),
    'time_nodes': one(TIME_NODES), 'time_edges': one(TIME_EDGES),
    'date_layer': one("SELECT COUNT(*) FROM points WHERE path LIKE '时间/日期%'"),
  },
  'signatures': {'points': sig(POINTS_SIG), 'lines': sig(LINES_SIG), 'fts': sig(FTS_SIG),
                 'settings': sig(SETTINGS_SIG)},
  'notes': {str(k): v for k, v in notes.items()},
  'note_tags': note_tags,
  'days': days, 'multi': multi, 'bad': bad,
  'feed_ids': [r[0] for r in c.execute(FEED_IDS)],
  'point_ids': [r[0] for r in c.execute('SELECT id FROM points ORDER BY id')],
  'settings': {k: v for k, v in c.execute('SELECT key, value FROM settings')},
  'date_layer_ids': [r[0] for r in c.execute(
      "SELECT id FROM points WHERE path = '时间/日期' OR path LIKE '时间/日期/%' ORDER BY id")],
  'integrity': one('PRAGMA integrity_check'),
  'fk': len(list(c.execute('PRAGMA foreign_key_check'))),
}
print(json.dumps(out, ensure_ascii=False))
`;

/** 只读快照（mode=ro）。返回读数 / 签名 / 笔记 / 日标签 / 设置 / 完整性。 */
export const readAxis = (dbPath) =>
  JSON.parse(execFileSync('python3', ['-c', PY, dbPath], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    stdio: ['ignore', 'pipe', 'inherit'],
  }));

/** S1 映射：`时间/日期` -> `时间`（`DATE_LAYER` 常量的只读副本）。 */
export const DATE_LAYER = '时间/日期';
export const mapDayLayer = (p) =>
  p === DATE_LAYER ? '时间' : (p.startsWith(DATE_LAYER + '/') ? '时间/' + p.slice(DATE_LAYER.length + 1) : p);

const sorted = (xs) => [...new Set(xs || [])].sort();
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameSet = (a, b) => { const sa = new Set(a); const sb = new Set(b); return sa.size === sb.size && [...sa].every((x) => sb.has(x)); };
const keys = (o) => Object.keys(o || {});

/** S1 树收敛断言：E1 标签集合映射 / E2 计数可解释 / E3 笔记集合 / E4 信息流 / E5 时间簇 / E6 设置。 */
export function compareTree(before, after) {
  const ids = sorted([...keys(before.note_tags), ...keys(after.note_tags)]);
  const e1diff = [];
  for (const id of ids) {
    const b = sorted((before.note_tags[id] || []).map(mapDayLayer));
    const a = sorted(after.note_tags[id]);
    if (!sameList(b, a)) e1diff.push({ id, before: b, after: a });
  }
  const del = before.date_layer_ids.filter((id) => !after.point_ids.includes(id)).length;
  const gone = before.date_layer_ids.filter((id) => !after.point_ids.includes(id));
  const merges = Math.max(del - 1, 0);
  const delta = {};
  for (const k of ['points', 'lines', 'fts', 'tree', 'closure', 'time_nodes', 'time_edges']) {
    delta[k] = after.readings[k] - before.readings[k];
  }
  const e2bad = Object.keys(delta).filter((k) => delta[k] !== -del);
  const mergeDelta = after.readings.merge_log - before.readings.merge_log;
  const e6 = [];
  for (const k of sorted([...keys(before.settings), ...keys(after.settings)])) {
    const b = before.settings[k]; const a = after.settings[k];
    const exp = b === undefined ? a : b.split(DATE_LAYER + '/').join('时间/').split('"' + DATE_LAYER + '"').join('"时间"');
    if (a !== exp) e6.push({ key: k, before: b, after: a, expected: exp });
  }
  for (const k of ['filter_current', 'ui.mru.tags', 'ui.pinned.tags']) {
    if ((after.settings[k] || '').includes(DATE_LAYER)) e6.push({ key: k, residue: true });
  }
  return {
    del, merges, e1diff, delta, e2bad,
    gone,
    mergeOk: mergeDelta === merges, mergeDelta,
    e3ok: sameSet(keys(before.note_tags), keys(after.note_tags)),
    feedOk: before.readings.feed === after.readings.feed && sameSet(before.feed_ids, after.feed_ids),
    leftover: after.readings.date_layer, e6,
    integrity: after.integrity, fk: after.fk,
    ok: e1diff.length === 0 && e2bad.length === 0 && mergeDelta === merges
      && sameSet(keys(before.note_tags), keys(after.note_tags))
      && before.readings.feed === after.readings.feed && sameSet(before.feed_ids, after.feed_ids)
      && after.readings.date_layer === 0 && e6.length === 0,
  };
}

/** S2 created_at 修复断言：① 对齐 / ② 无日标签不动 / ③ 只动一列 / ④ 一日多篇。 */
export function compareCreatedAt(before, after) {
  const hitIds = keys(after.days);
  const aligned = hitIds.filter((id) => after.notes[id] === after.days[id] + ' 00:00:00');
  const untouched = keys(after.notes).filter((id) => !(id in after.days));
  const untouchedDiff = untouched.filter((id) => after.notes[id] !== before.notes[id]);
  const flat = ['points', 'lines', 'fts', 'tree', 'closure', 'cited', 'feed', 'merge_log', 'time_nodes', 'time_edges', 'date_layer'];
  const readDiff = flat.filter((k) => before.readings[k] !== after.readings[k]);
  const sigDiff = ['points', 'lines', 'fts', 'settings'].filter((k) => before.signatures[k] !== after.signatures[k]);
  const dist = {};
  for (const id of hitIds) dist[after.days[id]] = (dist[after.days[id]] || 0) + 1;
  const collisions = Object.entries(dist).filter(([, n]) => n > 1)
    .map(([day, n]) => [day, n]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    hits: hitIds.length, aligned: aligned.length, bad: after.bad.length,
    daysBefore: keys(before.days).length, daysAfter: hitIds.length,
    untouched: untouched.length, untouchedDiff,
    readDiff, sigDiff, collisions,
    collisionNotes: collisions.reduce((s, [, n]) => s + n, 0),
    multiBefore: keys(before.multi).length, multiAfter: keys(after.multi).length,
    integrity: after.integrity, fk: after.fk,
    ok: hitIds.length === aligned.length && after.bad.length === 0
      && sameSet(keys(before.days), keys(after.days)) && untouchedDiff.length === 0
      && readDiff.length === 0 && sigDiff.length === 0,
  };
}
