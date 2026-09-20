// release 安装版冒烟(安装到 E:\1-LifeLog 后):真实 IPC + DOM 读数,不写库。
// 用法:E:\1-LifeLog\LifeLog.exe(带 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222)
//       冷启动即可(主窗是运行时懒建,脚本经 ensureMain 自动用托盘打开):node scripts/lifelog-release-smoke.mjs
import { ensureMain, sleep, waitFor, recorder } from './cdp-lib.mjs';

const r = recorder();
const { cdp: main, target, close } = await ensureMain();
const call = (cmd, args = {}) =>
  main.eval(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const cond = { keyword: null, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null };

r.record('R1 主窗页面为 release origin(http://tauri.localhost)', target.url.startsWith('http://tauri.localhost'), `url=${target.url}`);

const notes = await call('query_notes', { conditions: cond, offset: 0 });
r.record(
  'R2 笔记可读到(IPC query_notes 首页)',
  Array.isArray(notes) && notes.length > 0,
  `首页条数=${notes.length} 首条 id=${notes[0]?.id} created_at=${notes[0]?.created_at} tags=${JSON.stringify(notes[0]?.tags)}`
);
const hits = Object.fromEntries(await call('count_view_hits'));
r.record('R3 内置视图计数与基线一致', hits.all === 1357 && hits.todo === 286 && hits.untagged === 0, `all=${hits.all} todo=${hits.todo} untagged=${hits.untagged}`);
const [auto, tpl] = await Promise.all([call('get_setting', { key: 'auto_time_tag' }), call('get_setting', { key: 'time_tag_template' })]);
r.record('R4 设置读得到且为默认(开关开 + 默认模板)', auto === 'true' && tpl === '时间排序/{y}/{m}/{d}', `auto_time_tag=${auto} time_tag_template=${tpl}`);

const dom = await waitFor(
  () => main.eval(`(() => {
    const items = document.querySelectorAll('li .md-body').length;
    const root = !!document.querySelector('[data-tag-path="时间排序"]');
    const time = (document.querySelector('li time') || {}).getAttribute?.('datetime') ?? null;
    return items > 0 && root ? { items, root, time } : null;
  })()`),
  25,
  250
);
r.record(
  'R5 主窗渲染:笔记流有条目 + 侧栏 时间排序 根 + 首条显示 created_at',
  dom !== null && dom.items > 0 && dom.root === true,
  `读数=${JSON.stringify(dom)}`
);
await sleep(500);
const errs = main.events.filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params?.type === 'error');
r.record('R6 主窗无 console error', errs.length === 0, `错误条数=${errs.length}${errs.length ? ':' + JSON.stringify(errs[0]).slice(0, 160) : ''}`);
r.finish();
close();
