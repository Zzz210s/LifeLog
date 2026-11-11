import json, io, os

ob = set(json.load(io.open('ob-files.json', encoding='utf-8')))
root = 'F:/0-code/20-active/obsidian-sandbox'
disk = set()
for dp, _, fs in os.walk(root + '/拾枝'):
    for f in fs:
        if f.endswith('.md'):
            rel = os.path.relpath(os.path.join(dp, f), root)
            disk.add(rel.replace(os.sep, '/'))
print('obsidian', len(ob), 'disk', len(disk))
missing = sorted(disk - ob)
print('Obsidian 看不到的', len(missing))
for m in missing[:10]:
    print('  ', repr(m))
