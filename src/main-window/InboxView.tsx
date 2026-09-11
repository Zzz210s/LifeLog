import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../shared/api';
import type { Note } from '../shared/types';

/** 收件箱:最近 200 条速记,行 = 时间(灰) + #标签(蓝) + 正文,行尾可删除 */
export function InboxView(): ReactNode {
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void api
      .listRecentNotes(200)
      .then(setNotes)
      .catch((e) => setError(String(e)));
  }, []);

  const remove = (id: number) => {
    void api
      .deleteNote(id)
      .then(() => setNotes((prev) => prev.filter((n) => n.id !== id)))
      .catch((e) => setError(String(e)));
  };

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="px-6 py-4 text-lg font-semibold text-gray-800">收件箱</h1>
      {error && <div className="px-6 pb-2 text-xs text-red-500">{error}</div>}
      {notes.length === 0 && !error && (
        <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
          暂无记录,用快捷窗记点什么吧
        </div>
      )}
      <ul className="flex-1 overflow-y-auto px-6 pb-4">
        {notes.map((n) => (
          <li key={n.id} className="group flex items-start gap-3 border-b border-gray-100 py-2">
            <span className="shrink-0 pt-0.5 text-xs text-gray-400">
              {n.created_at.slice(5, 16)}
            </span>
            <div className="flex-1 text-sm text-gray-800">
              {n.tags.map((t) => (
                <span key={t} className="mr-1 text-blue-600">
                  #{t}
                </span>
              ))}
              <span className="whitespace-pre-wrap">{n.content}</span>
            </div>
            <button
              onClick={() => remove(n.id)}
              className="shrink-0 text-xs text-gray-300 hover:text-red-500 group-hover:text-gray-400"
            >
              删除
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
