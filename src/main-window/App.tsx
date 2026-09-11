import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../shared/api';
import type { Note } from '../shared/types';
import { Composer } from './Composer';
import { ErrorBars } from './ErrorBars';
import type { ErrorKind } from './ErrorBar';
import { dropError, putError } from './errors';
import type { ErrorMap } from './errors';
import { FilterBar } from './FilterBar';
import { matchesTagFilter, mergeNotes, needsRefetchAfterChange, replaceNote } from './notes-list';
import { NoteStream } from './NoteStream';
import { useNotesExport } from './use-export';

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
  const [errors, setErrors] = useState<ErrorMap>({});
  const [queryFailed, setQueryFailed] = useState(false); // 查询失败事实留存,供空态文案判定
  const [editingId, setEditingId] = useState<number | null>(null);
  const seq = useRef(0); // 过期响应丢弃(快速切筛选/翻页竞态)

  /** 按来源留存/清除:G4 单值槽会被跨源覆盖造成错误被吞,改为每个来源一份,成功路径只清同源 */
  const setError = useCallback((kind: ErrorKind, message: string) => {
    setErrors((prev) => putError(prev, kind, message));
  }, []);
  const clearError = useCallback((kind: ErrorKind) => {
    setErrors((prev) => dropError(prev, kind));
  }, []);
  const { exporting, exported, onExport } = useNotesExport(setError, clearError);

  const loadTags = useCallback(() => {
    void api
      .tagCounts()
      .then((rows) => {
        setAllTags(rows.map(([name, count]) => ({ name, count })));
        clearError('tags');
      })
      .catch((e) => setError('tags', '标签加载失败: ' + String(e)));
  }, [clearError]);

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
        setQueryFailed(false);
        clearError('query');
      } catch (e) {
        if (id !== seq.current) return;
        // 失败必须与"暂无记录"区分:错误行可见,且停掉分页避免哨兵反复重触发失败请求
        setError('query', '加载笔记失败: ' + String(e));
        setQueryFailed(true);
        setHasMore(false);
        if (!append) setNotes([]);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [keyword, tags, oldestFirst, clearError]
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

  /** 查询失败的恢复入口:重发首页(瞬时故障无需改筛选) */
  const retry = useCallback(() => {
    void fetchPage(0, false);
  }, [fetchPage]);

  /**
   * 变更后落库视图(G5 权衡):
   * 有关键词筛选时重查首页 —— keyword 同时匹配正文与标签两列,本地判不了命中,正确性优先于滚动位置;
   * 无关键词时就地更新,并本地移除不再满足标签筛选的条目(保住分页与滚动位置,S3)。
   */
  const applyNoteChange = useCallback(
    (updated: Note) => {
      if (needsRefetchAfterChange({ keyword, tags })) {
        void fetchPage(0, false);
        return;
      }
      setNotes((prev) => {
        const next = replaceNote(prev, updated);
        return matchesTagFilter(updated, tags) ? next : next.filter((n) => n.id !== updated.id);
      });
    },
    [keyword, tags, fetchPage]
  );

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
          clearError('action');
          loadTags();
        })
        .catch((e) => setError('action', '删除失败: ' + String(e)));
    },
    [loadTags, clearError]
  );

  const toggleTodo = useCallback(
    (note: Note) => {
      void api
        .toggleTodo(note.id)
        .then((updated) => {
          if (updated) applyNoteChange(updated);
          clearError('action');
          loadTags();
        })
        .catch((e) => setError('action', '切换待办状态失败: ' + String(e)));
    },
    [applyNoteChange, loadTags, clearError]
  );

  /** 编辑保存:用命令返回的就地更新,不重置分页(用户滚到深处编辑不会被弹回顶部) */
  const onEditSaved = useCallback(
    (note: Note) => {
      applyNoteChange(note);
      setEditingId(null);
      clearError('action');
      loadTags();
    },
    [applyNoteChange, loadTags, clearError]
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
        onExport={() => void onExport()}
        exporting={exporting}
        exported={exported}
      />
      <ErrorBars errors={errors} onRetry={retry} onDismiss={clearError} />
      <NoteStream
        notes={notes}
        queryFailed={queryFailed}
        onRetry={retry}
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
