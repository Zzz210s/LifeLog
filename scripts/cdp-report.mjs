// 验收脚本的共用件:逐项记录器、条件字面量、时间标签根、主窗绑定(自 cdp-lib.mjs 拆出,守 200 行红线)。

/** 逐项记录器:record(...) 打印并累计,finish() 汇总并设置退出码 */export function recorder() {
  const results = [];
  return {
    results,
    record(item, ok, detail) {
      results.push({ item, ok, detail });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${item}  ${detail ?? ''}`);
    },
    finish() {
      console.log('\n=== 汇总 ===');
      const fails = results.filter((r) => !r.ok);
      console.log(`通过 ${results.length - fails.length}/${results.length}`);
      if (fails.length) {
        fails.forEach((f) => console.log('FAIL 明细:', f.item, f.detail));
        process.exitCode = 1;
      }
    },
  };
}

/** 全空条件的 JSON 字面量,over 覆盖个别字段(与 Rust FilterConditions 同构) */
export const F = (over) => JSON.stringify(conditions(over));

/** 条件对象(Rust FilterConditions 同构;日期键 from/to 已随 D2 删除,故不再带);排序不算收窄条件 */
export const conditions = (over = {}) => ({
  keyword: null,
  tags: [],
  excludeTags: [],
  tagPresence: null,
  sort: 'newest',
  expr: null,
  ...over,
});

/**
 * 时间标签根名:真源是设置 `time_tag_template`(默认「时间排序/{y}/{m}/{d}」,用户可改成「日期/{y}/{m}/{d}」)。
 * 取模板里第一个 `{` 之前的路径段并与库内真实根标签对照;绝不硬编码根名(旧验收脚本写死
 * 「时间排序」,而真实库里早已改名为「日期」);模板为空/取不到时返回 null。
 */
export async function timeTagRoot(call) {
  const tpl = await call('get_setting', { key: 'time_tag_template' });
  const want = String(tpl ?? '').split('{')[0].replace(/\/+$/, '').trim();
  if (!want) return null;
  const hit = (await call('list_tags')).find((t) => t.path === want);
  return hit ? hit.path : want;
}

/**
 * 绑定主窗页面的常用动作:验收脚本都只用主窗做 IPC 断言/库存对照。
 * call 走真实 IPC;inventory 是库存快照:笔记数 + `id|首行` 清单(逐页取全,不是首页 50 条)+ 全部标签路径
 * + `tabs_state` 原文 + `theme` 原文(基线洁净断言与运行清单断言都基于它;保存视图与 `filter_last` 已删)。
 * liCount 数信息流里渲染出的笔记条数(条目根为 li 且内含 .md-body)。
 */
export function bindMain(cdp) {
  const call = (cmd, args = {}) =>
    cdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
  return {
    call,
    hits: async (over) => (await call('query_notes', { conditions: conditions(over), offset: 0 })).length,
    paths: async () => (await call('list_tags')).map((t) => t.path),
    liCount: () => cdp.eval(`document.querySelectorAll('li .md-body').length`),
    inventory: () =>
      cdp.eval(`(async () => {
        const T = window.__TAURI_INTERNALS__.invoke;
        const C = ${JSON.stringify(conditions({}))};
        let all = [], off = 0, page;
        do { page = await T('query_notes', { conditions: C, offset: off }); all = all.concat(page); off += 50; } while (page.length === 50);
        const tags = await T('list_tags');
        const tabsState = await T('get_setting', { key: 'tabs_state' });
        const theme = await T('get_setting', { key: 'theme' });
        return {
          notes: all.length,
          ids: all.map((n) => n.id + '|' + n.content.split(String.fromCharCode(10))[0]).sort(),
          paths: tags.map((t) => t.path).sort(),
          tabsState: tabsState === undefined ? null : tabsState,
          theme: theme === undefined ? null : theme,
        };
      })()`),
  };
}
