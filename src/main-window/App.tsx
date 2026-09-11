import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../shared/api';
import type { Note } from '../shared/types';
import { Composer } from './Composer';
import { FilterBar } from './FilterBar';
import { mergeNotes, replaceNote } from './notes-list';
import { NoteStream } from './NoteStream';

const PAGE = 50;

/** 主窗 v2:单列流 = Composer + FilterBar + NoteStream(无左侧导航) */
export function App(): ReactNode {
  const [keyword, setKeyword] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [allTags, setAllTags] = useState<{ name: string; count: number }[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const seq = useRef(0); // 过期响应丢弃(快速切筛选/翻页竞态)

  const loadTags = useCallback(() => {
    void api
      .tagCounts()
      .then((rows) => setAllTags(rows.map(([name, count]) => ({ name, count }))))
      .catch((e) => setError('标签加载失败: ' + String(e)));
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
        setError('');
      } catch (e) {
        if (id !== seq.current) return;
        // 失败必须与"暂无记录"区分:错误行可见,且停掉分页避免哨兵反复重触发失败请求
        setError('加载笔记失败: ' + String(e));
        setHasMore(false);
        if (!append) setNotes([]);
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

  /** 新增笔记后回第一页(新内容必在最前);就地变更走 replaceNote,不重置分页与滚动位置 */
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

  const remove = useCallback(
    (note: Note) => {
      if (!window.confirm('删除这条笔记?')) return;
      void api
        .deleteNote(note.id)
        .then(() => {
          setNotes((prev) => prev.filter((n) => n.id !== note.id));
          setEditingId(null);
          setError('');
          loadTags();
        })
        .catch((e) => setError('删除失败: ' + String(e)));
    },
    [loadTags]
  );

  const toggleTodo = useCallback(
    (note: Note) => {
      void api
        .toggleTodo(note.id)
        .then((updated) => {
          if (updated) setNotes((prev) => replaceNote(prev, updated));
          setError('');
          loadTags();
        })
        .catch((e) => setError('切换待办状态失败: ' + String(e)));
    },
    [loadTags]
  );

  /** 编辑保存:用命令返回的就地更新,不重置分页(用户滚到深处编辑不会被弹回顶部) */
  const onEditSaved = useCallback(
    (note: Note) => {
      setNotes((prev) => replaceNote(prev, note));
      setEditingId(null);
      setError('');
      loadTags();
    },
    [loadTags]
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
      {error && (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-600">
          <span role="alert" className="min-w-0 flex-1 truncate">
            {error}
          </span>
          <button
            onClick={() => setError('')}
            aria-label="关闭错误提示"
            className="shrink-0 text-red-500 hover:text-red-700"
          >
            关闭
          </button>
        </div>
      )}
      <NoteStream
        notes={notes}
        error={error}
        activeTags={tags}
        editingId={editingId}
        hasMore={hasMore}
        loading={loading}
        onLoadMore={loadMore}
        onTagClick={toggleTag}
        onEdit={(n) => setEditingId(n.id)}
        onDelete={remove}
        onToggleTodo={toggleTodo}
        onEditSaved={onEditSaved}
        onEditCancel={() => setEditingId(null)}
      />
    </div>
  );
}
