import type { ReactNode } from 'react';

interface Props {
  title: string;
  hint: string;
}

/** 未实现视图占位:标题 + 居中灰字提示 */
export function Placeholder({ title, hint }: Props): ReactNode {
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="px-6 py-4 text-lg font-semibold text-gray-800">{title}</h1>
      <div className="flex flex-1 items-center justify-center text-sm text-gray-400">{hint}</div>
    </div>
  );
}
