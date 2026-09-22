/**
 * when 文本层:表达式字符串 <-> AST(解析 + 序列化)。
 * 与 when-expr.ts 拆开只为守住单文件 200 行红线;这里只管文本,归一化与求值在 when-expr.ts
 * (when.ts 的 deserialize 统一归一化)。失败不抛异常而是返回带 0 基 offset 的结果,便于 validate 复用。
 */
import type { ContextKeyExpr, ContextValue } from './when-expr';

export type ParseResult =
  | { readonly ok: true; readonly expr: ContextKeyExpr }
  | { readonly ok: false; readonly reason: string; readonly offset: number };

/** 裸值(无需引号):键名同款字符集,另允许 / 与 - */
const BARE_VALUE = /^[\p{L}\p{N}_.\-/]+$/u;
/** 裸写会被读成字面量而不是字符串的词,序列化时必须加引号 */
const RESERVED = new Set(['true', 'false', 'null']);
const IDENT_CHAR = /[\p{L}\p{N}_.\-/]/u;
const WORD_START = /[\p{L}_]/u;
const NUMERIC = /^-?\d+(?:\.\d+)?$/;

/** 解析表达式文本;空白由调用方(when.ts)提前处理成恒真 */
export function parseWhenExpression(src: string): ParseResult {
  try {
    return { ok: true, expr: new Parser(src).parse() };
  } catch (e) {
    if (e instanceof ParseFailure) return { ok: false, reason: e.reason, offset: e.offset };
    throw e;
  }
}

/** 序列化:按优先级只在必要时加括号,保证 deserialize(serialize(e)) 等价 e */
export function serialize(expr: ContextKeyExpr): string {
  switch (expr.type) {
    case 'defined':
      return expr.key;
    case 'equals':
      return `${expr.key} == ${serializeValue(expr.value)}`;
    case 'not': {
      const inner = serialize(expr.expr);
      return expr.expr.type === 'and' || expr.expr.type === 'or' ? `!(${inner})` : `!${inner}`;
    }
    case 'and':
      if (expr.exprs.length === 0) return 'true';
      return expr.exprs.map((e) => (e.type === 'or' ? `(${serialize(e)})` : serialize(e))).join(' && ');
    case 'or':
      if (expr.exprs.length === 0) return 'false';
      return expr.exprs.map(serialize).join(' || ');
  }
}

function serializeValue(value: ContextValue): string {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (value === null || value === undefined) return 'null';
  if (BARE_VALUE.test(value) && !RESERVED.has(value)) return value;
  return `'${value.replace(/([\\'])/g, '\\$1')}'`;
}

class ParseFailure extends Error {
  constructor(
    readonly reason: string,
    readonly offset: number,
  ) {
    super(reason);
    this.name = 'ParseFailure';
  }
}

class Parser {
  private i = 0;

  constructor(private readonly src: string) {}

  parse(): ContextKeyExpr {
    const expr = this.parseOr();
    this.ws();
    if (this.i < this.src.length) this.fail('多余的输入');
    return expr;
  }

  private ws(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i])) this.i += 1;
  }

  private take(token: string): boolean {
    if (!this.src.startsWith(token, this.i)) return false;
    this.i += token.length;
    return true;
  }

  private fail(reason: string): never {
    throw new ParseFailure(reason, this.i);
  }

  private parseOr(): ContextKeyExpr {
    let expr = this.parseAnd();
    for (;;) {
      this.ws();
      if (!this.take('||')) return expr;
      expr = { type: 'or', exprs: [expr, this.parseAnd()] };
    }
  }

  private parseAnd(): ContextKeyExpr {
    let expr = this.parseUnary();
    for (;;) {
      this.ws();
      if (!this.take('&&')) return expr;
      expr = { type: 'and', exprs: [expr, this.parseUnary()] };
    }
  }

  private parseUnary(): ContextKeyExpr {
    this.ws();
    if (this.take('!')) return { type: 'not', expr: this.parseUnary() };
    return this.parsePrimary();
  }

  private parsePrimary(): ContextKeyExpr {
    this.ws();
    if (this.take('(')) {
      const inner = this.parseOr();
      this.ws();
      if (!this.take(')')) this.fail('缺少右括号「)」');
      return inner;
    }
    if (this.i >= this.src.length) this.fail('这里需要一个键名或「(」');
    const ch = this.src[this.i];
    if (ch === ')') this.fail('这里需要一个键名或「(」');
    if (ch === '&' || ch === '|') this.fail('逻辑运算要写成「&&」或「||」');
    if (ch === '=') this.fail('比较要写成「==」');
    const word = this.readWord();
    if (word === null) this.fail(`无法识别的字符「${ch}」`);
    if (word === 'true') return { type: 'and', exprs: [] };
    if (word === 'false') return { type: 'or', exprs: [] };
    this.ws();
    if (this.take('==')) return { type: 'equals', key: word, value: this.readValue() };
    if (this.take('!=')) return { type: 'not', expr: { type: 'equals', key: word, value: this.readValue() } };
    if (this.src[this.i] === '=') this.fail('比较要写成「==」');
    return { type: 'defined', key: word };
  }

  private readWord(): string | null {
    if (this.i >= this.src.length || !WORD_START.test(this.src[this.i])) return null;
    const start = this.i;
    while (this.i < this.src.length && IDENT_CHAR.test(this.src[this.i])) this.i += 1;
    return this.src.slice(start, this.i);
  }

  private readValue(): ContextValue {
    this.ws();
    if (this.i >= this.src.length) this.fail('缺少比较的值');
    const ch = this.src[this.i];
    if (ch === "'" || ch === '"') return this.readQuoted(ch);
    const start = this.i;
    while (this.i < this.src.length && !/[\s)&|=]/.test(this.src[this.i])) this.i += 1;
    const raw = this.src.slice(start, this.i);
    if (raw.length === 0) this.fail('缺少比较的值');
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    if (NUMERIC.test(raw)) return Number(raw);
    return raw;
  }

  private readQuoted(quote: string): string {
    this.i += 1;
    let out = '';
    while (this.i < this.src.length) {
      const ch = this.src[this.i];
      if (ch === '\\' && this.i + 1 < this.src.length) {
        out += this.src[this.i + 1];
        this.i += 2;
        continue;
      }
      if (ch === quote) {
        this.i += 1;
        return out;
      }
      out += ch;
      this.i += 1;
    }
    this.fail('字符串缺少收尾引号');
  }
}
