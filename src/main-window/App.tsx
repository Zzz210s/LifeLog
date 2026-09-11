import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../shared/api';
import type { Note } from '../shared/types';
import { Composer } from './Composer';
import { FilterBar } from './FilterBar';
import { NoteStream } from './NoteStream';

const PAGE = 50;

/** 追加分页去重(筛选翻转期间的新旧页可能交叠) */
function mergeNotes(prev: Note[], page: Note[]): Note[] {
  const seen = new Set(prev.map((n) => n.id));
  return [...prev, ...page.filter((n) => !seen.has(n.id))];
}

/** 主窗 v2:单列流 = Composer + FilterBar + NoteStream(无左侧导航) */
export function App(): ReactNode {
  const [keyword, setKeyword] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [allTags, setAllTags] = useState<{ name: string; count: number }[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const seq = useRef(0); // 过期响应丢弃(快速切筛选/翻页竞态)

  const loadTags = useCallback(() => {
    void api
      .tagCounts()
      .then((rows) => setAllTags(rows.map(([name, count]) => ({ name, count }))))
      .catch(() => {});
  }, []);

  /** 拉一页:append=true 追加(offset=当前长度),否则整表重置 */
  const fetchPage = useCallback(
    async (offset: number, append: boolean) => {
      const id = ++seq.current;
      setLoading(true);
      try {
        const page = await api.queryNotes({ keyword, tags, offset, limit: PAGE, oldestFirst });
        if (id !== seq.current) return;
        setNotes((prev) => (append ? mergeNotes(prev, page) : page));
        setHasMore(page.length === PAGE);
      } catch {
        if (id === seq.current && !append) setNotes([]);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [keyword, tags, oldestFirst]
  );

  // 任何筛选变化:整表重查 + 退出编辑态(fetchPage 身份随筛选变化)
  useEffect(() => {
    setEditingId(null);
    void fetchPage(0, false);
  }, [fetchPage]);

  useEffect(loadTags, [loadTags]);

  /** 变更后刷新:回第一页 + 重算标签计数(简单起见整表重置) */
  const refresh = useCallback(() => {
    setEditingId(null);
    void fetchPage(0, false);
    loadTags();
  }, [fetchPage, loadTags]);

  const loadMore = useCallback(() => {
    void fetchPage(notes.length, true);
  }, [fetchPage, notes]);

  const toggleTag = useCallback((name: string) => {
    setTags((prev) => (prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]));
  }, []);

  const remove = useCallback((note: Note) => {
    if (!window.confirm('删除这条笔记?')) return;
    void api.deleteNote(note.id).then(refresh).catch(() => {});
  }, [refresh]);

  const toggleTodo = useCallback(
    (note: Note) => {
      void api.toggleTodo(note.id).then(refresh).catch(() => {});
    },
    [refresh]
  );

  return (
    <div className="mx-auto flex h-screen w-full max-w-3xl flex-col bg-white text-gray-900">
      <Composer onSaved={refresh} />
      <FilterBar
        keyword={keyword}
        onKeyword={setKeyword}
        tags={tags}
        allTags={allTags}
        onToggleTag={toggleTag}
        oldestFirst={oldestFirst}
        onToggleSort={() => setOldestFirst((v) => !v)}
      />
      <NoteStream
        notes={notes}
        activeTags={tags}
        editingId={editingId}
        hasMore={hasMore}
        loading={loading}
        onLoadMore={loadMore}
        onTagClick={toggleTag}
        onEdit={(n) => setEditingId(n.id)}
        onDelete={remove}
        onToggleTodo={toggleTodo}
        onEditSaved={refresh}
        onEditCancel={() => setEditingId(null)}
      />
    </div>
  );
}
