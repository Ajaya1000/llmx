/**
 * Safe predicate compiler for skill pre/post states and edge conditions.
 *
 * Supported expression language (no arbitrary code execution):
 *
 *   literals:  true | false | numbers | "strings"
 *   lookups:   bare identifiers read from the TaskState kv map
 *   operators: == != < > <= >= and or not ( )
 */

enum TokenType {
  Ident = 'ident',
  Number = 'number',
  String = 'string',
  Op = 'op',
  LParen = 'lparen',
  RParen = 'rparen',
}

interface Token {
  type: TokenType;
  value: string;
}

const OPERATORS = ['==', '!=', '<=', '>=', '<', '>'];
const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false']);

class Lexer {
  private pos = 0;

  constructor(private readonly source: string) {}

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (/\s/.test(ch)) {
        this.pos++;
        continue;
      }
      if (ch === '(') {
        tokens.push({ type: TokenType.LParen, value: '(' });
        this.pos++;
        continue;
      }
      if (ch === ')') {
        tokens.push({ type: TokenType.RParen, value: ')' });
        this.pos++;
        continue;
      }
      if (ch === '"') {
        const str = this.readString();
        tokens.push({ type: TokenType.String, value: str });
        continue;
      }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(this.next()))) {
        const num = this.readWhile(/[0-9.]/);
        tokens.push({ type: TokenType.Number, value: num });
        continue;
      }
      if (/[a-zA-Z_]/.test(ch)) {
        const ident = this.readWhile(/[a-zA-Z0-9_]/);
        tokens.push({ type: TokenType.Ident, value: ident });
        continue;
      }
      const op = OPERATORS.find((o) => this.source.startsWith(o, this.pos));
      if (op) {
        tokens.push({ type: TokenType.Op, value: op });
        this.pos += op.length;
        continue;
      }
      throw new Error(`Unexpected character '${ch}' in predicate`);
    }
    return tokens;
  }

  private next(): string {
    return this.source[this.pos + 1] ?? '';
  }

  private readWhile(re: RegExp): string {
    let out = '';
    while (this.pos < this.source.length && re.test(this.source[this.pos])) {
      out += this.source[this.pos];
      this.pos++;
    }
    return out;
  }

  private readString(): string {
    this.pos++;
    let out = '';
    while (this.pos < this.source.length && this.source[this.pos] !== '"') {
      out += this.source[this.pos];
      this.pos++;
    }
    if (this.pos >= this.source.length) {
      throw new Error('Unterminated string literal in predicate');
    }
    this.pos++;
    return out;
  }
}

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  parse(): astNode {
    const node = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new Error(
        `Unexpected trailing tokens in predicate: '${this.source}'`,
      );
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private parseOr(): astNode {
    let left = this.parseAnd();
    while (
      this.peek()?.type === TokenType.Ident &&
      this.peek()!.value === 'or'
    ) {
      this.pos++;
      left = { kind: 'or', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): astNode {
    let left = this.parseNot();
    while (
      this.peek()?.type === TokenType.Ident &&
      this.peek()!.value === 'and'
    ) {
      this.pos++;
      left = { kind: 'and', left, right: this.parseNot() };
    }
    return left;
  }

  private parseNot(): astNode {
    const t = this.peek();
    if (t?.type === TokenType.Ident && t.value === 'not') {
      this.pos++;
      return { kind: 'not', operand: this.parseNot() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): astNode {
    const t = this.peek();
    if (!t) {
      throw new Error(`Unexpected end of predicate: '${this.source}'`);
    }
    if (t.type === TokenType.LParen) {
      this.pos++;
      const inner = this.parseOr();
      if (this.peek()?.type !== TokenType.RParen) {
        throw new Error(`Missing ')' in predicate: '${this.source}'`);
      }
      this.pos++;
      return inner;
    }
    return this.parseComparison();
  }

  private parseComparison(): astNode {
    const left = this.parseOperand();
    const t = this.peek();
    if (t?.type === TokenType.Op) {
      this.pos++;
      const right = this.parseOperand();
      return { kind: 'compare', op: t.value, left, right };
    }
    // Bare identifier: truthy check (must be boolean or undefined-false)
    return { kind: 'truthy', operand: left };
  }

  private parseOperand(): astNode {
    const t = this.peek();
    if (!t) {
      throw new Error(`Unexpected end of predicate: '${this.source}'`);
    }
    if (t.type === TokenType.Number) {
      this.pos++;
      return { kind: 'lit', value: Number(t.value) };
    }
    if (t.type === TokenType.String) {
      this.pos++;
      return { kind: 'lit', value: t.value };
    }
    if (t.type === TokenType.Ident) {
      this.pos++;
      if (t.value === 'true') return { kind: 'lit', value: true };
      if (t.value === 'false') return { kind: 'lit', value: false };
      if (KEYWORDS.has(t.value)) {
        throw new Error(`Keyword '${t.value}' used as a value`);
      }
      return { kind: 'lookup', name: t.value };
    }
    throw new Error(`Unexpected token '${t.value}' in predicate`);
  }
}

type astNode =
  | { kind: 'lit'; value: unknown }
  | { kind: 'lookup'; name: string }
  | { kind: 'truthy'; operand: astNode }
  | { kind: 'not'; operand: astNode }
  | { kind: 'and'; left: astNode; right: astNode }
  | { kind: 'or'; left: astNode; right: astNode }
  | { kind: 'compare'; op: string; left: astNode; right: astNode };

type PredicateFn = (kv: Record<string, unknown>) => boolean;

function evaluate(node: astNode, kv: Record<string, unknown>): boolean {
  switch (node.kind) {
    case 'lit':
      return Boolean(node.value);
    case 'lookup':
      return true; // handled inside compare/truthy contexts via lookupValue
    case 'truthy':
      return lookupValue(node.operand, kv) === true;
    case 'not':
      return !evaluate(node.operand, kv);
    case 'and':
      return evaluate(node.left, kv) && evaluate(node.right, kv);
    case 'or':
      return evaluate(node.left, kv) || evaluate(node.right, kv);
    case 'compare': {
      const left = lookupValue(node.left, kv);
      const right = lookupValue(node.right, kv);
      switch (node.op) {
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '<':
          return Number(left) < Number(right);
        case '>':
          return Number(left) > Number(right);
        case '<=':
          return Number(left) <= Number(right);
        case '>=':
          return Number(left) >= Number(right);
        default:
          throw new Error(`Unknown comparison operator '${node.op}'`);
      }
    }
  }
}

function lookupValue(node: astNode, kv: Record<string, unknown>): unknown {
  if (node.kind === 'lit') return node.value;
  if (node.kind === 'lookup') {
    if (!(node.name in kv)) {
      throw new Error(`State variable '${node.name}' is not defined`);
    }
    return kv[node.name];
  }
  throw new Error('Boolean expression used where a value is required');
}

/**
 * Compile a condition/predicate string into a pure function over the state kv.
 * Compilation validates the expression; the returned function throws on
 * undefined state variables at evaluation time (missing-state is an error,
 * not silently false).
 */
export function compilePredicate(source: string): PredicateFn {
  const tokens = new Lexer(source).tokenize();
  const ast = new Parser(tokens, source).parse();
  return (kv: Record<string, unknown>) => evaluate(ast, kv);
}

/**
 * Compile a preState.required check: every entry must hold in the state.
 * Entry values may be literals (exact equality) or predicate strings.
 */
export function compilePreState(
  required: Record<string, unknown> | undefined,
): PredicateFn {
  const checks: PredicateFn[] = [];
  for (const [key, expected] of Object.entries(required ?? {})) {
    if (typeof expected === 'string') {
      const compiled = compilePredicate(expected);
      checks.push((kv) => compiled(kv));
    } else {
      checks.push((kv) => key in kv && kv[key] === expected);
    }
  }
  return (kv) => checks.every((check) => check(kv));
}
