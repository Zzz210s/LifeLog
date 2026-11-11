const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const expr = `(() => {
  const app = window.app;
  if (!app) return 'no-app';
  const md = app.vault.getMarkdownFiles();
  const bases = app.vault.getFiles().filter((f) => f.extension === 'base').map((f) => f.path);
  const rel = md.find((f) => (app.metadataCache.getFileCache(f)?.frontmatter ?? {}).国籍);
  const ent = md.find((f) => f.path.includes('/实体/'));
  const note = md.find((f) => f.path.includes('/笔记/'));
  const fmOf = (f) => app.metadataCache.getFileCache(f)?.frontmatter;
  return JSON.stringify({
    vault: app.vault.adapter.basePath,
    md: md.length,
    bases,
    plugin: !!app.plugins?.plugins?.lifelog,
    relNote: rel?.path,
    relFm: rel ? Object.keys(fmOf(rel)).filter((k) => !k.startsWith('lifelog_') && k !== 'position') : null,
    ent: ent?.path, entFm: fmOf(ent),
    note: note?.path, noteLinks: note ? Object.keys(app.metadataCache.resolvedLinks?.[note.path] ?? {}) : null,
  });
})()`;
for (const t of list.filter((x) => x.type === 'page')) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  const out = await new Promise((res) => {
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id === 1) res(m.result?.result?.value); });
    setTimeout(() => res('timeout'), 15000);
  });
  ws.close();
  if (typeof out === 'string' && out.includes('obsidian-sandbox')) { console.log(out); process.exit(0); }
}
console.log('没找到沙盒 vault 的窗口，targets: ' + list.map((t) => t.url).join(' | '));
