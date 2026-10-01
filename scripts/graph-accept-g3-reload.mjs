/**
 * 关系图 G3 真机读数的读数 7:别处(侧栏,不在图里)改名标签 -> 图自动重载且**相机与选中都保留**。
 *
 * 这条钉的是 `App.tagsVersion -> ViewHost.dataVersion -> GraphView.useGraphVersion` 这条 prop 链:
 * 改名后 tags-changed 出口 -> useTagRows 重载 -> 版本 +1 -> 图重取数据,而相机 / 选中 / 展开是调用方状态,
 * 一个都不该复位。T5 报告说这条链没有集成测试,只有真机读数能咬住 —— 所以这里给三个独立观测:
 *   ① 版式:改名前搜索新名字**搜不到**,改名后能搜到(= 视图的 nodes 真的换了);
 *   ② 这次改名后信息条直接显示**新路径**(选中是标签 id,不是路径 —— 数据换了、选中没丢);
 *   ③ 相机:先按 `+` 缩进一档,前后帧的点位跨度逐位不变(= 没被重新适配)。
 * (原本还想装 IPC 计数器数 `graph_data` 调用,但 `window.__TAURI_INTERNALS__.invoke` 是
 *  non-writable + non-configurable 的冻结属性,包不上 —— ① ② 已经够,不再绕。)
 *
 * 靶点选"独子叶子":父级只有它一个可见子节点 -> 改名不动同层序遍历,径向布局逐点不变,
 * 于是"跨度变了"只可能来自相机被重置;名字不含行内 md 标记,搜索串才与落库名一致;
 * 也不在当前筛选条件里,免得改名级联改写 filter_current(那就不算只读对账了)。
 *
 * **改名不是只读**:Rust 的 `tags::rename` 会把旧完整路径与旧叶子名登记成别名(spec D4)。
 * 所以本读数收尾要把这次新登记的那几条删掉,并用只读 SQLite 核对别名表与开工前逐项一致。
 */
import { sleep } from './cdp-lib.mjs';
import { renameTagViaMenu } from './no-tabs-accept-lib.mjs';
import { aliasDump, clickAt, lastFrame, sameAliases, searchState, setSearch } from './graph-accept-g3-lib.mjs';
import { nodeSpot } from './graph-accept-g3-scene.mjs';

const PRESS_PLUS = `window.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }))`;
/** 改名靶点的后缀:不含 `/`、空白、`#`(标签名校验)与行内 md 标记 */
const SUFFIX = 'z';
const MD_MARK = /[[\]*~`|^$=#]/;
const spreadOf = (dots) => (dots.length === 0 ? 0 : Math.round((Math.max(...dots.map((d) => d.x)) - Math.min(...dots.map((d) => d.x))) * 100) / 100);
const infoBar = (cdp) => cdp.eval(`document.querySelector('[data-testid="graph-info-bar"]')?.textContent ?? null`);

export async function runReload({ cdp, ev, ui, bm, record, base, filterCurrent }) {
  const aliasesBefore = aliasDump();
  const aliasNames = new Set(aliasesBefore.map((r) => r.split('|')[0]));
  const paths = await bm.paths();
  const tagPaths = new Set(paths);
  const parents = new Set(base.nodes.map((n) => (n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '')));
  const childCount = new Map();
  for (const n of base.nodes) {
    const parent = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '';
    childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
  }
  const inFilter = new Set((JSON.parse(filterCurrent ?? '{}').tags ?? []).map((t) => t.path));
  const target = base.nodes.find((n) => {
    const name = n.path.split('/').pop();
    const parent = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '';
    // 独子叶子 + 名字干净 + 两个名字都不是已有别名/标签(别名登记才不会顶掉别人的别名,收尾才删得干净)
    return !parents.has(n.path) && childCount.get(parent) === 1 && !MD_MARK.test(name) && !inFilter.has(n.path) &&
      !aliasNames.has(name) && !aliasNames.has(name + SUFFIX) && !tagPaths.has(name + SUFFIX) && !tagPaths.has(n.path + SUFFIX);
  });
  let detail = '找不到可用的"独子叶子"靶点(要求:父级只一个可见子节点、名字不含 md、不在筛选条件里、新旧名都不是已有别名/标签)';
  let ok = false;
  if (target !== undefined) {
    const name = target.path.split('/').pop();
    const newName = name + SUFFIX;
    const newPath = target.path.slice(0, target.path.length - name.length) + newName;
    const aim = await nodeSpot(cdp, target.id);
    if (aim === null) {
      detail = `靶 ${target.path} 在画布上点不中(圆心未命中自己)`;
    } else {
      await clickAt(cdp, aim.originX + aim.local.x, aim.originY + aim.local.y);
      await sleep(500);
      const bar0 = await infoBar(cdp);
      const selected0 = typeof bar0 === 'string' && bar0.includes(name);
      await ev(PRESS_PLUS);
      await ev(PRESS_PLUS);
      await sleep(900);
      const frA = await lastFrame(cdp);
      const spread0 = spreadOf(frA?.dots ?? []);
      await setSearch(cdp, newName);
      await sleep(400);
      const beforeReload = await searchState(cdp);
      await setSearch(cdp, '');
      await sleep(300);
      const renamed = await renameTagViaMenu(ui, target.path, newName);
      await setSearch(cdp, newName);
      let afterReload = await searchState(cdp);
      for (let i = 0; i < 20 && !(afterReload?.items ?? []).some((t) => t.includes(newName)); i++) {
        await sleep(300);
        afterReload = await searchState(cdp);
      }
      const bar1 = await infoBar(cdp);
      const frB = await lastFrame(cdp);
      const spread1 = spreadOf(frB?.dots ?? []);
      const noHitBefore = !(beforeReload?.items ?? []).some((t) => t.includes(newName));
      const hitAfter = (afterReload?.items ?? []).some((t) => t.includes(newName));
      const keepOk = typeof bar1 === 'string' && bar1.includes(newName) && Math.abs(spread1 - spread0) <= 1 && frB?.fills === frA?.fills;
      await setSearch(cdp, '');
      await sleep(300);
      const restored = await renameTagViaMenu(ui, newPath, name);
      for (let i = 0; i < 20; i++) {
        if ((await bm.paths()).includes(target.path)) break;
        await sleep(300);
      }
      const backOk = restored === true && (await bm.paths()).includes(target.path);
      // 删掉这次改名自动登记的旧名(旧完整路径 + 旧叶子名,两次改名共 4 条),再用只读 SQLite 核对全表
      const created = [target.path, name, newPath, newName].filter((x, i, a) => a.indexOf(x) === i);
      for (const a of created) await bm.call('remove_tag_alias', { alias: a });
      await sleep(300);
      const aliasesAfter = aliasDump();
      const aliasOk = sameAliases(aliasesBefore, aliasesAfter);
      ok = renamed === true && selected0 && noHitBefore && hitAfter && keepOk && backOk && aliasOk;
      detail = `靶 id=${target.id} ${target.path} -> ${newPath}(独子叶子:父级可见子节点 1 个,改名不动布局);` +
        `改名=${renamed};改名前已选中=${selected0}(信息条含「${name}」);图内搜索「${newName}」候选 改名前=${JSON.stringify(beforeReload?.items ?? [])} -> 改名后=${JSON.stringify(afterReload?.items ?? [])};` +
        `改写后信息条=「${bar1}」(含新名=${typeof bar1 === 'string' && bar1.includes(newName)});缩放档点位跨度 ${spread0} -> ${spread1}` +
        `(相机保留 = 逐位不变,被重新适配会掉回适配档)、点数 ${frA?.fills} -> ${frB?.fills};` +
        `改回原名=${backOk};别名表回收 ${created.join('、')} 后与开工前逐项一致=${aliasOk}(${aliasesBefore.length} 条)`;
    }
  }
  record('G3-7 侧栏改名标签:图自动重载且相机与选中都保留(版本变化)', ok, detail);
}
