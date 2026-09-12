-- 005: 设置键更名(快捷输入 -> 输入栏):quick_* -> input_*
-- 只按键名前缀搬值,值本身不动;INSERT OR IGNORE 保证新旧键并存时以新键为准(不覆盖),
-- 随后统一删除旧键 —— 整个批次在 migrate::run 的单事务里执行,重复执行为空操作。
-- 用 substr 判断前缀而非 LIKE:'_' 是 LIKE 的通配符,'quick_%' 会误伤 quickfool 这类键。
INSERT OR IGNORE INTO settings(key, value)
SELECT 'input_' || substr(key, 7), value FROM settings WHERE substr(key, 1, 6) = 'quick_';
DELETE FROM settings WHERE substr(key, 1, 6) = 'quick_';
