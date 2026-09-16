// 表达式验收的"读数场景"库(自 dev-cdp-accept-expr.mjs 拆出以守 200 行上限):
// 读数 1-6 的页面驱动与断言。所有页面动作经 ctx.x(window.__X),数据断言经 ctx.call(IPC)。
// 命名口径:自建标签全在 验收6/ 命名空间,笔记标记「验收六」,与 cleanup 的运行清单一致。
import { sleep } from './cdp-lib.mjs';

/** 测试标签引用(全部落在 验收6/ 命名空间内) */
export const T = (p) => '#验收6/' + p;
export const BAD = '#工作 AND'; // 末尾类错误:position = 7 = 字符数
export const E3 = `(${T('工作')} OR ${T('生活')}) AND NOT ${T('临时')}`;
export const E3A = `${T('工作')} AND NOT ${T('临时')}`;
export const E5 = `${T('项目A')} OR ${T('项目B')}`;
export const E5R = `${T('项目X')} OR ${T('项目B')}`;
export const VIEW = '验收六视图';
/** 夹具:甲/乙 命中,丙 带被排除标签(负例),丁/戊 让 项目A/项目B 存在 */
export const FIXTURES = [
  `${T('工作')} 验收六甲`,
  `${T('生活')} 验收六乙`,
  `${T('工作')} ${T('临时')} 验收六丙`,
  `${T('项目A')} 验收六丁`,
  `${T('项目B')} 验收六戊`,
];
/** 与前端 filter-chips.ts 的 EXPR_TEXT_MAX 同口径(chip 可见文案截断,title 保留全文) */
export const MAX_EXPR_TEXT = 40;
export const trunc = (s) => ([...s].length <= MAX_EXPR_TEXT ? s : [...s].slice(0, MAX_EXPR_TEXT).join('') + '…');

/** 构造读者:ctx 提供页面动作与常用断言小工具(main 脚本里注入,便于两处复用) */
export function createReadings(ctx) {
  const { x, j, record, call, rows, listTags, listViews, waitX, waitFor, has, ids, norm, same } = ctx;

  /** 读数 1/2/2b:合法给绿色中文预览;非法红框 + 末尾文案 + 光标落点;非法时「确定」禁用 */
  async function read12() {
    await x('openExpr()');
    await x('fillExpr(' + j(E3) + ')');
    const s1 = await waitX('status()', (v) => v && v.kind === 'ok');
    record('读数1 合法表达式实时通过并给中文预览', !!s1 && s1.text.startsWith('预览:'), j(s1));
    await x('fillExpr(' + j(BAD) + ')');
    const s2 = await waitX('status()', (v) => v && v.kind === 'err');
    const ok = !!s2 && s2.text === '表达式末尾:缺少操作数' && s2.danger === true && s2.sel[0] === 7 && s2.sel[1] === 7;
    record('读数2 非法表达式红框 + 「表达式末尾:缺少操作数」+ 光标落点(下标 7)', ok, j(s2));
    const dis = await x('confirmDisabled()');
    record('读数2b 非法表达式时「确定」按钮处于禁用态', dis === true, j({ disabled: dis }));
  }

  /** 读数 3:非空夹具下 chips/摘要原文 + 表达式命中 == 等价结构化条件 + 被排除标签的笔记不出现 */
  async function read3(exId) {
    await x('openExpr()');
    await x('fillExpr(' + j(E3) + ')');
    await waitX('status()', (v) => v && v.kind === 'ok');
    await x("clickIn('表达式','确定')");
    const chips = await waitX('chips()', (c) => c && has(c, (y) => y.label === '表达式:' + trunc(E3)));
    const chip = chips && chips.find((c) => c.label === '表达式:' + trunc(E3));
    const sum = await x('summary()');
    const dom = await x('texts()');
    const orRows = await rows({ expr: E3 });
    const orIds = ids(orRows);
    const uni = [];
    for (const leaf of ['工作', '生活']) {
      uni.push(...ids(await rows({ tags: [{ path: '验收6/' + leaf, includeChildren: true }] })));
    }
    const notRows = ids(await rows({ tags: [{ path: '验收6/临时', includeChildren: true }] }));
    const union = [...new Set(uni)].filter((id) => !notRows.includes(id)).sort((a, b) => a - b);
    const andExpr = ids(await rows({ expr: E3A }));
    const struct = ids(await rows({
      tags: [{ path: '验收6/工作', includeChildren: true }],
      excludeTags: [{ path: '验收6/临时', includeChildren: true }],
    }));
    // 非空夹具前置断言:两侧都必须真有命中,否则"逐 id 一致"是空洞成立
    const fixtureOk = orIds.length > 0 && union.length > 0 && notRows.includes(exId);
    // 负例:带被排除标签的笔记既不得进表达式命中,也不得出现在渲染列表里
    const notHit = !orIds.includes(exId) && !dom.some((t) => t.includes('验收六丙'));
    const domOk = orIds.length === dom.length && orRows.every((n) => has(dom, (t) => norm(t) === norm(n.content)));
    const ok = !!chip && chip.title === '表达式:' + E3 && !!sum && sum.text.includes(trunc(E3)) &&
      sum.title.includes(E3) && fixtureOk && same(orIds, union) && same(andExpr, struct) && domOk && notHit;
    record('读数3 非空夹具下 chips/摘要显示原文;OR 与结构化并集、AND 与 tags+excludeTags 逐 id 一致 + 负例不命中',
      ok, j({ chip, sum, dom, orIds, union, andExpr, struct, fixtureOk, domOk, notHit, exId }));
    return chips;
  }

  /** 读数 3b:非法表达式不写库 —— 「确定」被拒、对话框不关闭、filter_last/视图/条件快照前后一致 */
  async function read3b(chipsBefore) {
    // 先等读数 3 的合法条件落盘(500ms 节流窗口):否则拿 null 基线去比,
    // 会把读数 3 自己的迟到写入误判成"非法表达式写库"
    const settled = await waitFor(async () => {
      const v = await call('get_setting', { key: 'filter_last' });
      return v && String(v).includes(E3) ? { v } : null;
    }, 16, 250);
    const fl0 = settled ? settled.v : await call('get_setting', { key: 'filter_last' });
    const v0 = j(await listViews());
    await x('openExpr()');
    await x('fillExpr(' + j(BAD) + ')');
    await waitX('status()', (v) => v && v.kind === 'err');
    const refused = await x("clickIn('表达式','确定')");
    const stillOpen = (await x('exprValue()')) === BAD;
    await x('esc()');
    await waitX('exprValue()', (v) => v === null, 8);
    await sleep(700); // 超过 500ms 写库节流窗口:若真有写库这里必然落盘
    const fl1 = await call('get_setting', { key: 'filter_last' });
    const chipsSame = same(await x('chips()'), chipsBefore);
    record('读数3b 非法表达式不写库:「确定」被拒 + filter_last / 视图 / 条件 chips 快照前后一致',
      refused === false && stillOpen && !!settled && same(fl0, fl1) && v0 === j(await listViews()) && chipsSame,
      j({ refused, stillOpen, settled: !!settled, before: fl0, after: fl1, viewsSame: v0 === j(await listViews()), chipsSame }));
  }

  /** 读数 4:点表达式 chip 再编辑、Esc 不保存(改过的文本丢弃)、删除 chip 后条件消失 */
  async function read4(before) {
    await x("clickChipButton('编辑条件')");
    const opened = await waitX('exprValue()', (v) => v !== null, 8);
    await x('fillExpr(' + j(T('生活')) + ')');
    await waitX('status()', (v) => v && v.kind === 'ok');
    await x('esc()');
    const closed = await waitX('exprValue()', (v) => v === null, 8);
    const kept = same(await x('chips()'), before);
    await x("clickChipButton('编辑条件')");
    const reopen = await waitX('exprValue()', (v) => v !== null, 8);
    await x("clickIn('表达式','取消')");
    await x("clickChipButton('移除条件')");
    const gone = await waitX('chipArea()', (v) => v === false, 8);
    record('读数4 表达式 chip 可再编辑 / Esc 不保存 / 删除该项后条件消失',
      opened === E3 && closed === null && kept && reopen === E3 && gone === false, j({ opened, closed, kept, reopen, gone }));
  }

  /** 读数 5:保存为视图 -> 改名级联跟随(含"无失效路径不画圆点")-> 删标签后行内失效提示且文本不变 */
  async function read5() {
    await x('openExpr()');
    await x('fillExpr(' + j(E5) + ')');
    await waitX('status()', (v) => v && v.kind === 'ok');
    await x("clickIn('表达式','确定')");
    await waitX('chipArea()', Boolean);
    // 走侧栏「+」入口保存:顶栏「保存为视图」不通知侧栏重载(旁证:实测 10.5s 内新行不出现),
    // 而本读数要断言的就是侧栏视图行,故用会触发 load() 的那个入口
    console.log('INFO 读数5 用侧栏 + 保存视图(顶栏入口不触发侧栏重载,属既有行为,不在本任务范围)');
    await x('saveViewFromSidebar(' + j(VIEW) + ')');
    const id = await waitFor(async () => {
      const v = (await listViews()).find((v) => v.title === VIEW);
      return v ? v.id : null;
    }, 16);
    if (id === null) {
      record('读数5a 保存为视图 + 改名跟随 + broken_paths 为空时不画失效圆点', false, '视图未落库');
      return null;
    }
    const v0 = (await listViews()).find((v) => v.id === id);
    // 视图行由侧栏异步重载,轮询到行挂载后再断言"无失效路径不画圆点"
    const row0 = await waitX('viewRow(' + id + ')', (r) => !!r, 16);
    const clean0 = v0.broken_paths.length === 0 && !!row0 && row0.broken === null;
    await x('ensureTag(' + j('验收6/项目A') + ')');
    await x('renameTag(' + j('验收6/项目A') + ',' + j('项目X') + ')');
    const renamed = await waitFor(async () => has((await listTags()).map((t) => t.path), (p) => p === '验收6/项目X'));
    const v1 = (await listViews()).find((v) => v.id === id);
    const chips1 = await x('applyViewFor(' + id + ',' + j('验收6/项目X') + ')');
    const row1 = await x('viewRow(' + id + ')');
    const clean1 = v1.broken_paths.length === 0 && !!row1 && row1.broken === null;
    record('读数5a 保存为视图 + 标签改名后条件表达式文本跟随 + broken_paths 为空时视图行不画失效圆点',
      !!renamed && v0.conditions.expr === E5 && v1.conditions.expr === E5R && !!chips1 && clean0 && clean1,
      j({ id, renamed, before: v0.conditions.expr, after: v1.conditions.expr, chips: chips1 && chips1.map((c) => c.label), broken0: v0.broken_paths, row0, clean0, clean1 }));

    await x('ensureTag(' + j('验收6/项目B') + ')');
    const del = await x('deleteTag(' + j('验收6/项目B') + ')');
    const v2 = await waitFor(async () => {
      const v = (await listViews()).find((v) => v.id === id);
      return v && v.broken_paths.length > 0 ? v : null;
    });
    const row = await waitX('viewRow(' + id + ')', (r) => r && r.broken, 16);
    const b = row && row.broken;
    record('读数5b 删除标签后视图行出现失效提示且表达式文本不变',
      del === true && !!v2 && v2.conditions.expr === E5R && v2.broken_paths.join('、') === '验收6/项目B' &&
        !!b && b.paths === '验收6/项目B' && b.title === '引用了已不存在的标签: 验收6/项目B',
      j({ del, expr: v2 && v2.conditions.expr, broken: v2 && v2.broken_paths, row: b }));
    await sleep(900); // 等 filter_last 节流落盘(读数 6 依赖)
    return id;
  }

  /** 读数 6:重启后条件与视图(含失效提示)仍在 */
  async function readRestart() {
    const chips = await waitX('chips()', (c) => c && has(c, (y) => y.label.startsWith('表达式:')), 16);
    const v = (await listViews()).find((v) => v.title === VIEW);
    const row = v && (await x('viewRow(' + v.id + ')'));
    const b = row && row.broken;
    record('读数6 重启后表达式条件与视图(含失效提示)仍在',
      !!chips && !!b && b.title === '引用了已不存在的标签: 验收6/项目B' && !!v && v.conditions.expr === E5R,
      j({ chips: chips && chips.map((c) => c.label), expr: v && v.conditions.expr, row: b }));
  }

  return { read12, read3, read3b, read4, read5, readRestart };
}
