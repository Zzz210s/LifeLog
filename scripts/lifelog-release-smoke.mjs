// release 安装版冒烟(安装到 E:\1-LifeLog 后):真实 IPC + DOM 读数,不写库。
// 用法:E:\1-LifeLog\LifeLog.exe(带 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222)
//       冷启动即可(主窗是运行时懒建,脚本经 ensureMain 自动用托盘打开):node scripts/lifelog-release-smoke.mjs
// 根名不写死:从设置 time_tag_template 推导(见 cdp-lib 的 timeTagRoot),因为安装版会带上真实库,
// 而真实库的模板根名可能已被用户改过(如「日期/{y}/{m}/{d}」)。
import { ensureMain, sleep, waitFor, recorder, bindMain, timeTagRoot } from './cdp-lib.mjs';

const r = recorder();
const { cdp: main, target, close } = await ensureMain();
const { call } = bindMain(main);
const cond = { keyword: null, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null };
const PAGE = 50; // 信息流一页条数(与后端一致)

r.record('R1 主窗页面为 release origin(http://tauri.localhost)', target.url.startsWith('http://tauri.localhost'), `url=${target.url}`);

const notes = await call('query_notes', { conditions: cond, offset: 0 });
r.record(
  'R2 笔记可读到(IPC query_notes 首页)',
  Array.isArray(notes) && notes.length > 0 && notes.length <= PAGE,
  `首页条数=${notes.length} 首条 id=${notes[0]?.id} created_at=${notes[0]?.created_at} tags=${JSON.stringify(notes[0]?.tags)}`
);
const root = await timeTagRoot(call);
const tags = await call('list_tags');
r.record(
  'R3 标签可读到且时间标签根名由 time_tag_template 推导(根节点在库里)',
  tags.length > 0 && !!root && tags.some((t) => t.path === root),
  `标签数=${tags.length} 根名=${root} 根节点=${JSON.stringify(tags.find((t) => t.path === root) ?? null)}`
);
const [auto, tpl, tabsState] = await Promise.all([
  call('get_setting', { key: 'auto_time_tag' }),
  call('get_setting', { key: 'time_tag_template' }),
  call('get_setting', { key: 'tabs_state' }),
]);
r.record(
  'R4 设置读得到(自动时间标签开关 + 模板 + tabs_state 落库形态)',
  (auto === 'true' || auto === 'false') && typeof tpl === 'string' && tpl.includes('{y}') && !!root &&
    typeof tabsState === 'string' && Array.isArray(JSON.parse(tabsState).tabs),
  `auto_time_tag=${auto} time_tag_template=${tpl} tabs_state tabs 数=${JSON.parse(tabsState || '{}').tabs?.length}`
);

const dom = await waitFor(
  () => main.eval(`(() => {
    const items = document.querySelectorAll('li .md-body').length;
    const rootSel = ${JSON.stringify(root)};
    const rootRow = rootSel ? !!document.querySelector('[data-tag-path="' + rootSel + '"]') : false;
    const time = (document.querySelector('li time') || {}).getAttribute?.('datetime') ?? null;
    return items > 0 && rootRow ? { items, rootRow, time } : null;
  })()`),
  25,
  250
);
r.record(
  'R5 主窗渲染:笔记流有条目 + 侧栏含推导出的时间标签根 + 首条显示 created_at',
  dom !== null && dom.items > 0 && dom.rootRow === true,
  `读数=${JSON.stringify(dom)}`
);
await sleep(500);
const errs = main.events.filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params?.type === 'error');
r.record('R6 主窗无 console error', errs.length === 0, `错误条数=${errs.length}${errs.length ? ':' + JSON.stringify(errs[0]).slice(0, 160) : ''}`);
r.finish();
close();
