/**
 * 绘制层（从 app 的 GraphCanvas.tsx 抽出）：ctx + DrawPlan → 像素。
 * 宿主（Tauri 窗口 / Obsidian ItemView）只负责准备 canvas 与 DPR，颜色一律走 `setToken()` 注入的令牌读取器。
 * 绘制顺序与半透明归位点与原生逐行一致，改动必须同时跑两边的用例。
 */
import type { Dot, DrawPlan } from '../draw/graph-draw-plan';
import { AXIS_DIM_ALPHA, CO_ALPHA, CO_DASH, DIM_ALPHA, EDGE_DIM_ALPHA, LINK_DASH, TREE_ALPHA } from '../draw/graph-edge-style';
import { strokeAll, strokeRelations } from './graph-canvas-strokes';
import { drawRelationMarks } from './graph-canvas-remarks';
import { NOTE_R } from './graph-notes';
import { token } from './tokens';

const HUB_RING_GAP = 3;
const HUB_RING_WIDTH = 2;
const RING_GAP = 3;

export function paint(ctx: CanvasRenderingContext2D, plan: DrawPlan, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  strokeAll(ctx, plan.co, token('--color-border-strong'), 1.25, CO_ALPHA, { dimAlpha: EDGE_DIM_ALPHA, dash: CO_DASH });
  strokeAll(ctx, plan.tree, token('--color-border-strong'), 1.5, TREE_ALPHA, { dimAlpha: AXIS_DIM_ALPHA });
  strokeAll(ctx, plan.links, token('--color-accent'), 1.5, 1, { dimAlpha: EDGE_DIM_ALPHA, dash: LINK_DASH });
  if (plan.relations.length > 0) {
    strokeRelations(ctx, plan.relations, token('--color-accent'));
  }
  for (const d of plan.dots) {
    ctx.globalAlpha = d.dim ? DIM_ALPHA : 1;
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
  const agg: Dot[] = [];
  const rings: Dot[] = [];
  for (const d of plan.dots) {
    if ((d.count ?? 1) > 1) agg.push(d);
    if (d.selected) rings.push(d);
  }
  if (agg.length > 0) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = token('--color-raised');
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const d of agg) ctx.fillText(String(d.count), d.x, d.y);
  }
  ctx.globalAlpha = 1;
  const hubs = plan.hubs ?? [];
  if (hubs.length > 0) {
    ctx.strokeStyle = token('--color-border-strong');
    ctx.lineWidth = HUB_RING_WIDTH;
    for (const h of hubs) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r + HUB_RING_GAP, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  if (rings.length > 0) {
    ctx.strokeStyle = token('--color-accent');
    ctx.lineWidth = 2;
    for (const d of rings) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r + RING_GAP, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  if (plan.notes.length > 0) {
    ctx.strokeStyle = token('--color-border-strong');
    ctx.lineWidth = 1;
    for (const n of plan.notes) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, NOTE_R, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.fillStyle = token('--color-muted');
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  if (plan.overflow !== null) {
    ctx.fillText(`+${plan.overflow.n}`, plan.overflow.x, plan.overflow.y);
  }
  drawRelationMarks(ctx, plan.relationMarks);
  for (const l of plan.labels) ctx.fillText(l.text, l.x, l.y);
}
