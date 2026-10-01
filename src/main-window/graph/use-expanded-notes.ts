/**
 * 展开笔记(G2 Task 6):把一个标签下的笔记取回来,算成画布要画的那圈小圆。
 * 「展开」是就地看这批笔记的落点,不把图换成笔记视图。
 *
 * **取数**:`queryNotes(expandedConditions(path), 0)` —— 条件对象与信息流**同一份形状**
 * (从 `defaultFilterState()` 出发只覆盖 `tags`),这样「图里展开的笔记」与
 * 「点筛到信息流后的结果」是同一批;页大小由后端定(50 条),够覆盖 `NOTE_LIMIT` 个圆。
 * 只取第一页:第二页在 G2 没有消费者(单条定位是 G3 的事)。
 *
 * **条数口径**:总数取 `GraphNode.notes`(**含子孙**去重,与侧栏计数同源;展开的是"这一支的全部") ,
 * `noteFan` 内部按 `NOTE_LIMIT` 封顶,略去的条数交给 `+N`。取数结果的用处是两件事:
 * ① 确认这批笔记真的取得出来 —— 标签刚改名/合并而图数据还没重拉时库里可能是空的,
 * 照 `node.notes` 画就是一圈点不出东西的幽灵圆;② 知道最多画得出几个圆。
 * 因此取到 0 条时一个圆都不画(而不是画满 20 个)。
 *
 * **坐标**:对外全是**屏幕坐标**(先把标签落点过一遍 `screenOf`,半径直接用屏幕像素)
 * —— G3 起笔记小圆与标签点同口径:不随相机缩放,`k=0.2` 时不会缩进标签点里面。
 * 点小圆的命中吃 client 坐标,故 `onNoteClick` 拿容器原点现算(命中容差 `NOTE_R + HIT_SLOP`,
 * 与 `graph-hit` 对标签点的口径一致:G2 只做「带着该标签回信息流」,单条定位留给 G3)。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../shared/api';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { GraphNode } from '../../shared/types';
import { defaultFilterState } from '../filter/filter-state';
import { screenOf, type Camera } from './graph-camera';
import { radiusOf } from './graph-draw-plan';
import { HIT_SLOP } from './graph-hit';
import { noteFan, NOTE_R, type NoteSpace } from './graph-notes';
import type { Point } from './radial';

/** 小圆离标签圆心的间距(屏幕像素:标签点与笔记小圆都在屏幕口径) */
const FAN_GAP = 14;

/** 空扇形:同一份模块级对象(未展开/加载中时不要因为换了空数组而让 plan 作废) */
const EMPTY_FAN: { space: NoteSpace; dots: Point[]; overflow: { x: number; y: number; n: number } | null } = {
  space: 'screen',
  dots: [],
  overflow: null,
};

/**
 * 展开笔记的查询条件:与信息流同一份形状,只有 `tags` 收窄到该路径。
 * `includeChildren: true` 与 `node.notes`(含子孙)和「筛到信息流」(侧栏点标签)同口径
 * —— 三处必须一起动,否则图里展开的那批会与筛过去的结果对不上。
 */
export function expandedConditions(path: string): FilterConditions {
  return { ...defaultFilterState(), tags: [{ path, includeChildren: true }] };
}

/** 一次取数的读数:失败也留痕(空数组分不出"库里没有"与"压根没问到") */
interface PageRead {
  id: number;
  ok: boolean;
  count: number;
}

export interface ExpandedNotesApi {
  /** 小圆的坐标口径(恒为屏幕):上层把它随 dots 一起递进 drawPlan,别再猜 */
  space: NoteSpace;
  /** 笔记小圆(屏幕坐标);未展开/加载中/取不到一律为空 */
  dots: Point[];
  /** 略去的条数提示位(世界坐标,标签圆心处);没有略去时为 null */
  overflow: { x: number; y: number; n: number } | null;
  loading: boolean;
  failed: boolean;
  /** 点中小圆返回 true(上层据此不再当画布点击 —— 那会先把选中清掉) */
  onNoteClick: (e: { clientX: number; clientY: number }) => boolean;
}

export function useExpandedNotes(input: {
  /** 当前展开的标签;null = 没展开(不发请求) */
  node: GraphNode | null;
  /** 标签落点(世界坐标:相机叠加记忆位置之后的那一份) */
  points: Map<number, Point>;
  cam: Camera;
  /** 容器左上角的视口位置(命中要把 client 坐标换算进画布) */
  origin: () => Point;
  /** 点中笔记小圆:带着该标签回信息流 */
  onFilterToStream: (path: string) => void;
}): ExpandedNotesApi {
  const { node, points, cam, origin, onFilterToStream } = input;
  const id = node?.id ?? null;
  const path = node?.path ?? null;
  const [read, setRead] = useState<PageRead | null>(null);

  useEffect(() => {
    if (id === null || path === null) return; // 没展开就不发请求
    let alive = true;
    void api.queryNotes(expandedConditions(path), 0).then(
      (rows) => {
        if (alive) setRead({ id, ok: true, count: rows.length });
      },
      () => {
        if (alive) setRead({ id, ok: false, count: 0 });
      },
    );
    return () => {
      alive = false; // 换对象/收起后迟到的回包不碰状态
    };
  }, [id, path]);

  // 读数只认当前展开的那个标签:换了对象就当还没回包(渲染期归零,不留一帧错配)
  const cur = read !== null && read.id === id ? read : null;
  const fetched = cur !== null && cur.ok ? cur.count : 0;

  const fan = useMemo(() => {
    const p = node === null ? undefined : points.get(node.id);
    if (node === null || p === undefined) return EMPTY_FAN;
    const total = Math.max(node.notes, 0);
    // 屏幕口径:标签点先换成屏幕坐标,半径也是屏幕像素 —— 小圆不随相机缩放
    const f = noteFan({
      center: screenOf(p, cam),
      count: total,
      radius: radiusOf(total) + FAN_GAP,
      space: 'screen',
    });
    // 只画真取到的小圆(取不到的笔记没有实体;取到 0 条就是一圈都不画)
    // 页大小 > NOTE_LIMIT,正常情况这条截断不生效 —— 它只在图数据与库不同步时拦一下
    const dots = f.dots.slice(0, fetched);
    return dots.length === 0 ? EMPTY_FAN : { space: f.space, dots, overflow: f.overflow };
  }, [node, points, cam, fetched]);

  const onNoteClick = useCallback(
    (e: { clientX: number; clientY: number }): boolean => {
      if (fan.dots.length === 0 || path === null) return false;
      const o = origin();
      const reach = NOTE_R + HIT_SLOP;
      // 小圆已经是屏幕坐标:直接拿 client 减原点的画布坐标比距离,不再过相机
      const hit = fan.dots.some(
        (d) => Math.hypot(d.x - (e.clientX - o.x), d.y - (e.clientY - o.y)) <= reach,
      );
      if (hit) onFilterToStream(path);
      return hit;
    },
    [fan.dots, cam, origin, onFilterToStream, path],
  );

  return {
    space: fan.space,
    dots: fan.dots,
    overflow: fan.overflow,
    loading: id !== null && cur === null,
    failed: cur !== null && !cur.ok,
    onNoteClick,
  };
}
