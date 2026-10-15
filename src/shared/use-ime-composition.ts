/**
 * 输入法组合(IME composition)守卫:拼音在**上屏前**不得进入下游查询/候选/筛选回写。
 *
 * 症状(用户报告 2026-10-15):拼音输入法组合中的原始拼音被当成搜索词 —— 候选按拼音收窄、
 * `/` 筛选按拼音搜,300ms 后的防抖还把拼音写进 `settings.filter_current`。根因是**取值侧**
 * 没有守卫:组合中每次 `input` 都带着原始拼音走过 `onChange`,而既有守卫只在键盘侧
 * (`isComposing` 不抢 Esc/Enter)。
 *
 * 口径(不能在组合中直接丢弃 `onChange` —— 那会让受控输入框「打不进字」):
 *  - `value`(显示值)组合中照常实时跟随:拼音可见、光标不丢、受控不断;
 *  - `committed`(下游值)组合中冻结在组合前那一版;`compositionend` 才放行最终文本、恰好一次;
 *  - 判据优先取 `input` 事件的 `isComposing`(权威),`compositionend` 兜底 —— 有些提交路径
 *    (实测 WebView2 上 `Input.insertText`)只补一次 `isComposing:true` 的 input 再补
 *    `compositionend`,不给非组合 input,只等 isComposing:false 会永远冻着。
 */
import { useMemo, useRef, useState } from 'react';

export interface ImeFlag {
  /** 是否处于组合中(拼音未上屏) */
  composing: boolean;
  /**
   * 按原生事件更新:`input` 事件的 `isComposing` 才认组合。`compositionend` 不带这个属性
   * (它本身就是「组合结束」),所以同一个入口也能把标志收回 false。
   */
  sync: (nativeEvent: Event) => void;
  setComposing: (v: boolean) => void;
}

export function useComposing(): ImeFlag {
  const [composing, setComposing] = useState(false);
  return {
    composing,
    sync: (ev) => setComposing('isComposing' in ev && ev.isComposing === true),
    setComposing,
  };
}

/** 组合中把下游值冻结在组合开始前的那一版;非组合时原样放行 */
export function useImeCommitted<T>(live: T, composing: boolean): T {
  const frozen = useRef(live);
  if (!composing) frozen.current = live;
  return composing ? frozen.current : live;
}

export interface ImeInputHandlers {
  /** 接元素 onChange:第二个参数给原生事件(组合判定只看它的 isComposing) */
  onChange: (text: string, nativeEvent: Event) => void;
  /** 接元素 onCompositionEnd:上屏文本立即提交(不赌后面还会不会有非组合 input) */
  onCompositionEnd: (text: string) => void;
}

export interface ImeInput {
  /** 受控元素的显示值 */
  value: string;
  /** 下游(查询/候选/筛选回写)用的值 */
  committed: string;
  /** 组合中 */
  composing: boolean;
  /** 程序化整体替换(清空/采纳/预填) */
  setValue: (text: string) => void;
  handlers: ImeInputHandlers;
}

/** 值放在本地状态的输入面(受控或非受控都可用)一次给全的接线 */
export function useImeInput(initial = ''): ImeInput {
  const [value, setValue] = useState(initial);
  const flag = useComposing();
  const committed = useImeCommitted(value, flag.composing);
  // flag 每次渲染都是新对象,但它的两个方法只用到稳定的 setter:闭包住第一份即可
  const handlers = useMemo<ImeInputHandlers>(
    () => ({
      onChange: (text, ev) => {
        setValue(text);
        flag.sync(ev);
      },
      onCompositionEnd: (text) => {
        flag.setComposing(false);
        setValue(text);
      },
    }),
    [],
  );
  return { value, committed, composing: flag.composing, setValue, handlers };
}
