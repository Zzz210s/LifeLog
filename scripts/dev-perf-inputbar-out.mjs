// 输入栏启动读数的汇总与打印(见 dev-perf-inputbar.mjs):把口径无关的统计与表格从运行逻辑里拆出来。
import { stat, table } from './dev-perf-lib.mjs';
import { flagLargest } from './dev-perf-inputbar-page.mjs';

/** 取样本里非空值,便于 stat() */
export const col = (samples, f) => samples.map(f).filter((v) => v !== null && v !== undefined);

/** A 口径(自然启动)中位汇总 */
export function summarize(all) {
  const summary = {};
  for (const [mode, samples] of Object.entries(all)) {
    summary[mode] = {
      输入栏可见: stat(col(samples, (s) => s.inputVisibleMs)),
      导航开始: stat(col(samples, (s) => s.navStartMs)),
      页面首帧: stat(col(samples, (s) => s.fpFromSpawnMs)),
      设置已应用: stat(col(samples, (s) => s.settingsAppliedMs)),
      置顶IPC完成: stat(col(samples, (s) => s.aotAppliedMs)),
      首帧相对可见: stat(col(samples, (s) => s.gapFpMs)),
      设置相对首帧: stat(col(samples, (s) => s.gapSettingsMs)),
      WebView2渲染器: stat(col(samples, (s) => s.wvRendererMs)),
      JS执行累计: stat(col(samples, (s) => s.scriptMs)),
      主线程任务累计: stat(col(samples, (s) => s.taskMs)),
    };
  }
  return summary;
}

/** A 口径逐样本表 + 中位行 */
export function printStartup(all, summary) {
  for (const [mode, samples] of Object.entries(all)) {
    console.log(`\n=== ${mode} ===`);
    table(['样本', '可见ms', '导航ms', '首帧ms', '设置已应用ms', '置顶完成ms', '首帧-可见', '设置-首帧', 'WV2渲染器ms', 'JS执行ms'],
      samples.map((s, i) => [i + 1, s.inputVisibleMs, s.navStartMs, s.fpFromSpawnMs, s.settingsAppliedMs,
        s.aotAppliedMs, s.gapFpMs, s.gapSettingsMs, s.wvRendererMs, s.scriptMs]));
    console.log('中位:', JSON.stringify(summary[mode]));
  }
}

/** 启动资源清单:取第一个拿到页面读数的样本,decoded 最大者标注出来(基线即 200KB+ 的共享 chunk) */
export function pickResources(all) {
  const sample = Object.values(all).flat().find((s) => s.resources.length);
  if (!sample) return [];
  const top = flagLargest(sample.resources);
  return sample.resources.map((r) => ({
    file: r.file, transferKb: Math.round(r.transfer / 1024), decodedKb: Math.round(r.decoded / 1024),
    largest: r.file === top,
  }));
}

export function printResources(resources) {
  if (!resources.length) return;
  console.log('\n=== 启动时加载的 JS/CSS(自然启动,transfer/decoded 为单次样本)===');
  table(['资源', 'transfer KB', 'decoded KB', '大块'], resources.map((r) => [r.file, r.transferKb, r.decodedKb, r.largest ? '<=' : '']));
}

/** B 口径(重载)打印,并返回 JS 自耗时中位与整体中位 */
export function printReload(reload) {
  const jsKeys = [...new Set(reload.samples.flatMap((s) => Object.keys(s.jsByUrl)))];
  const jsMedian = Object.fromEntries(jsKeys.map((k) => [k, stat(col(reload.samples, (s) => s.jsByUrl[k])).median]));
  console.log('\n=== 重载口径:按 chunk 的 JS 自耗时中位(Profiler 采样 50us)===');
  table(['chunk', 'JS自耗时ms'], Object.entries(jsMedian).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v]));
  const reloadSummary = {
    首帧: stat(col(reload.samples, (s) => s.fpMs)),
    设置已应用: stat(col(reload.samples, (s) => s.settingsAppliedMs)),
    设置相对首帧: stat(col(reload.samples, (s) => s.gapSettingsMs)),
    JS总: stat(col(reload.samples, (s) => s.jsTotalMs)),
    长任务ms: stat(col(reload.samples, (s) => s.longTaskMs)),
    chunks: reload.samples[0]?.chunksKb,
  };
  console.log('中位:', JSON.stringify(reloadSummary));
  return { jsMedian, reloadSummary };
}
