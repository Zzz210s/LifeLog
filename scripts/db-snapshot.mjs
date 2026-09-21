/** 真实库只读快照(库存计数 + 主库/WAL 的 mtime/size/md5 + SAVEPROBE 夹具行):用于「有没有写库」的取证。 */
import { execFileSync } from 'node:child_process';

const DB = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
const SQL = `import hashlib,json,os,sqlite3
DB = ${JSON.stringify(DB)}
def stat(p):
    if not os.path.exists(p): return {'exists': False}
    with open(p, 'rb') as f: md5 = hashlib.md5(f.read()).hexdigest()
    return {'exists': True, 'size': os.path.getsize(p), 'mtime': os.stat(p).st_mtime_ns, 'md5': md5}
c = sqlite3.connect('file:' + DB + '?mode=ro', uri=True)
print(json.dumps({
  'notes': c.execute('select count(*) from notes').fetchone()[0],
  'tags': c.execute('select count(*) from tags').fetchone()[0],
  'links': c.execute('select count(*) from tag_links').fetchone()[0],
  'db': stat(DB), 'wal': stat(DB + '-wal'),
  'probe': c.execute("select id, content from notes where content like '%SAVEPROBE%' order by id").fetchall()}))`;

export const snapshot = () =>
  JSON.parse(execFileSync('python', ['-c', SQL], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }).toString());

/** 「有没有写库」的对比口径:主库与 WAL 的 md5 都没变 -> 这一次操作没有落盘 */
export const untouched = (a, b) =>
  JSON.stringify(a.db) === JSON.stringify(b.db) && JSON.stringify(a.wal) === JSON.stringify(b.wal) &&
  a.notes === b.notes && a.tags === b.tags && a.links === b.links;
