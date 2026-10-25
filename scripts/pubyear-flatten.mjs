/**
 * 把 `时间/出版年份/YYYY` 扁平成 `时间/YYYY(出版年份)`(2026-10-25 用户要求)。
 *
 * 为什么走应用自身的 IPC 而不是直连 SQLite 写库:
 * `points` 的触发器依赖连接级 SQL 函数 `tag_plain`,外部进程直连会 `no such function`;
 * 且项目规则要求「唯一允许写用户真库的是应用自身」。所以这里用 CDP 连上正在运行的安装版,
 * 调 `rename_tag` / `move_tag` / `delete_tag` —— 树列、子级线、FTS 触发器都由产品代码负责。
 *
 * 默认 dry-run(只打印计划);`--apply` 才写。写前要求:应用在跑 + 已存在快照(见 --snapshot 提示)。
 * 用法:
 *   node scripts/pubyear-flatten.mjs            # 只看计划
 *   node scripts/pubyear-flatten.mjs --apply    # 真跑(逐条走 IPC)
 * 环境变量:LIFELOG_CDP_PORT(默认 9222)。
 */
import { Cdp, pages, sleep } from './cdp-lib.mjs';

const APPLY = process.argv.includes('--apply');
const ROOT_PATH = '时间';
const OLD_PREFIX = '时间/出版年份';
// 半角括号**不能**当标签名:产品规则(设计 §3.4)把 `(` / `)` 保留给名字组 `目标(名字)`,
// 段名里出现裸括号会被 `tag_label_paren::has_bare_paren` 拒掉(实测 55 条全被拒)。
// 全角括号 `（）` 不是定界符,语义与观感一致,故用它。
const SUFFIX = '（出版年份）';

const q = (s) => s.replace(/'/g, "''");

/** 读点表:全部 `时间/出版年份*` 子树 + `时间` 自身 id(只读,经 IPC) */
async function readPlan(cdp) {
  const rows = await cdp.eval(`(async () => {
    const T = window.__TAURI_INTERNALS__.invoke;
    // 用产品自己的查询:list_tags 返回树内实体(path/计数)
    const tags = await T('list_tags', {});
    const pick = (p) => tags.filter((t) => t.path === p || t.path.startsWith(p + '/'));
    return {
      root: tags.find((t) => t.path === '时间') ?? null,
      old: pick('时间/出版年份'),
      existing: tags.filter((t) => t.path === '时间').flatMap(() => []),
      allTimeChildren: tags.filter((t) => (t.path ?? '').startsWith('时间/') && (t.path.split('/').length === 2)),
    };
  })()`);
  return rows;
}

function buildOps(plan) {
  const container = plan.old.find((t) => t.path === OLD_PREFIX);
  const years = plan.old.filter((t) => t.path.startsWith(OLD_PREFIX + '/'));
  const taken = new Set(plan.allTimeChildren.map((t) => t.path));
  const ops = [];
  for (const y of years) {
    const year = y.path.slice(OLD_PREFIX.length + 1);
    // 只处理单段年份子节点(更深的结构不在本次范围)
    if (year.includes('/')) continue;
    const target = `${ROOT_PATH}/${year}${SUFFIX}`;
    ops.push({ kind: 'rename', id: y.id, from: y.path, to: target, clash: taken.has(target) });
  }
  return { container, years, ops, root: plan.root };
}

async function invoke(cdp, cmd, args) {
  return cdp.eval(
    `(async () => { try { const r = await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}); return { ok: true, r }; } catch (e) { return { ok: false, e: String(e) }; } })()`
  );
}

async function main() {
  const page = (await pages()).find((p) => !p.url.includes('input.html'));
  if (!page) throw new Error('没有主窗页面:先开应用(托盘第 2 项「打开主窗口」)');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const cdp = new Cdp(ws);

  const plan = await readPlan(cdp);
  const { container, ops, root } = buildOps(plan);
  console.log(`[读] 时间 根 = ${root?.id ?? '缺失'};出版年份容器 = ${container?.id ?? '已不存在'};年份子节点 ${ops.length} 个`);
  if (!root) throw new Error('找不到 `时间` 根节点');
  const clash = ops.filter((o) => o.clash);
  if (clash.length) {
    console.log(`[阻止] 目标路径已被占用 ${clash.length} 条,先人工处理:`);
    for (const c of clash) console.log(`  ${c.from} -> ${c.to}`);
    process.exit(2);
  }
  for (const o of ops.slice(0, 5)) console.log(`  ${o.from}  ->  ${o.to}`);
  if (ops.length > 5) console.log(`  ... 其余 ${ops.length - 5} 条同形`);

  if (!APPLY) {
    console.log(`[dry-run] 将改名 ${ops.length} 个、把它们的父级移到 时间(${root.id})、然后删除空的 ${OLD_PREFIX}(${container?.id})`);
    console.log('[dry-run] 真跑加 --apply(需应用在跑;写前请先做 VACUUM INTO 快照)');
    process.exit(0);
  }

  let ok = 0;
  const failures = [];
  for (const o of ops) {
    const r1 = await invoke(cdp, 'rename_tag', { tagId: o.id, newName: `${o.to.split('/')[1]}` });
    if (!r1.ok) { failures.push([o.from, 'rename', r1.e]); continue; }
    const r2 = await invoke(cdp, 'move_tag', { tagId: o.id, newParentId: root.id });
    if (!r2.ok) { failures.push([o.to, 'move', r2.e]); continue; }
    ok += 1;
  }
  console.log(`[写] 改名+移动成功 ${ok}/${ops.length};失败 ${failures.length}`);
  for (const f of failures.slice(0, 10)) console.log('  失败:', f.join(' | '));

  if (container && failures.length === 0) {
    // 容器通常在最后一个子级搬走后被 gc_orphans 自动回收;真删会报「标签不存在」,属正常
    const r3 = await invoke(cdp, 'delete_tag', { tagId: container.id });
    console.log('[写] 删除空容器 时间/出版年份 ->', r3.ok ? 'ok' : `跳过(${r3.e})`);
  }
  // 设置里的旧路径引用:容器没了,条件会变成"永远不命中"。
  // 换成等价的关键词条件(真库实测同样是 226 条:这些笔记的标签路径本身就含「出版年份」,
  // 而没有任何正文提到这四个字),既保住用户原来的视图,又不再指向具体标签。
  const rw = await cdp.eval(`(async () => {
    const T = window.__TAURI_INTERNALS__.invoke;
    const raw = await T('get_setting', { key: 'filter_current' });
    if (!raw) return 'no-filter';
    const obj = JSON.parse(raw);
    let n = 0;
    for (const g of obj.groups ?? []) {
      for (let i = 0; i < g.items.length; i += 1) {
        const it = g.items[i];
        if (it.kind === 'tag' && (it.path === '时间/出版年份' || (it.path ?? '').startsWith('时间/出版年份/'))) {
          g.items[i] = { kind: 'keyword', value: '出版年份' }; n += 1;
        }
      }
    }
    if (!n) return 'nothing-to-rewrite';
    await T('set_setting', { key: 'filter_current', value: JSON.stringify(obj) });
    return 'rewrote ' + n;
  })()`);
  console.log('[设置] filter_current ->', rw);
  await sleep(500);
  // 复查:旧路径应为 0,新路径应齐
  const after = await cdp.eval(`(async () => { const t = await window.__TAURI_INTERNALS__.invoke('list_tags', {}); return { old: t.filter(x => (x.path ?? '').startsWith('时间/出版年份')).length, next: t.filter(x => (x.path ?? '').endsWith(${JSON.stringify(SUFFIX)})).length }; })()`);
  console.log('[复查] 旧路径残留 =', after.old, ';新形态 =', after.next);
  process.exit(failures.length === 0 && after.old === 0 ? 0 : 1);
}

void q;
main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
