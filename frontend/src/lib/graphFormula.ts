import type { JsonObject, JsonValue } from "../types";

export const INPUT_FORMULAS_LAYOUT_KEY = "input_formulas";
const TARGET_KEY_SEPARATOR = "::";

export interface InputFormulaBinding {
  token: string;
  from_node_id: string;
  from_port_id: string;
}

export interface InputFormulaConfig {
  expression: string;
  inputs: InputFormulaBinding[];
}

export type InputFormulaMap = Record<string, InputFormulaConfig>;

export type GraphFormulaTokenType = "identifier" | "number" | "operator" | "lparen" | "rparen";

export interface GraphFormulaToken {
  type: GraphFormulaTokenType;
  value: string;
  start: number;
  end: number;
}

interface TokenizeResult {
  tokens: GraphFormulaToken[];
  errors: string[];
}

export interface GraphFormulaValidationResult {
  isValid: boolean;
  errors: string[];
  tokens: GraphFormulaToken[];
}

export const GRAPH_FORMULA_UNARY_FUNCTIONS = ["abs", "ceil", "floor", "ampdb", "dbamp"] as const;
export const GRAPH_FORMULA_LITERAL_IDENTIFIERS = ["sr"] as const;
const GRAPH_FORMULA_UNARY_FUNCTION_SET = new Set<string>(GRAPH_FORMULA_UNARY_FUNCTIONS);
const GRAPH_FORMULA_LITERAL_IDENTIFIER_SET = new Set<string>(GRAPH_FORMULA_LITERAL_IDENTIFIERS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifierToken(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function toFormulaConfig(value: unknown): InputFormulaConfig | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.expression !== "string") {
    return null;
  }
  if (!Array.isArray(value.inputs)) {
    return null;
  }

  const inputs: InputFormulaBinding[] = [];
  for (const entry of value.inputs) {
    if (!isRecord(entry)) {
      continue;
    }
    const token = typeof entry.token === "string" ? entry.token.trim() : "";
    const fromNodeId = typeof entry.from_node_id === "string" ? entry.from_node_id.trim() : "";
    const fromPortId = typeof entry.from_port_id === "string" ? entry.from_port_id.trim() : "";
    if (!token || !fromNodeId || !fromPortId || !isIdentifierToken(token)) {
      continue;
    }
    inputs.push({
      token,
      from_node_id: fromNodeId,
      from_port_id: fromPortId
    });
  }

  return {
    expression: value.expression,
    inputs
  };
}

export function formulaTargetKey(toNodeId: string, toPortId: string): string {
  return `${toNodeId}${TARGET_KEY_SEPARATOR}${toPortId}`;
}

export function parseFormulaTargetKey(key: string): { toNodeId: string; toPortId: string } | null {
  const separatorIndex = key.indexOf(TARGET_KEY_SEPARATOR);
  if (separatorIndex < 1) {
    return null;
  }
  const toNodeId = key.slice(0, separatorIndex).trim();
  const toPortId = key.slice(separatorIndex + TARGET_KEY_SEPARATOR.length).trim();
  if (!toNodeId || !toPortId) {
    return null;
  }
  return { toNodeId, toPortId };
}

export function readInputFormulaMap(uiLayout: JsonObject): InputFormulaMap {
  const raw = uiLayout[INPUT_FORMULAS_LAYOUT_KEY];
  if (!isRecord(raw)) {
    return {};
  }

  const result: InputFormulaMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!parseFormulaTargetKey(key)) {
      continue;
    }
    const config = toFormulaConfig(value);
    if (!config) {
      continue;
    }
    result[key] = config;
  }
  return result;
}

export function writeInputFormulaMap(uiLayout: JsonObject, map: InputFormulaMap): JsonObject {
  const nextLayout: JsonObject = { ...uiLayout };
  const entries = Object.entries(map);

  if (entries.length === 0) {
    delete nextLayout[INPUT_FORMULAS_LAYOUT_KEY];
    return nextLayout;
  }

  const nextFormulaObject: Record<string, JsonValue> = {};
  for (const [key, config] of entries) {
    nextFormulaObject[key] = {
      expression: config.expression,
      inputs: config.inputs.map((binding) => ({
        token: binding.token,
        from_node_id: binding.from_node_id,
        from_port_id: binding.from_port_id
      }))
    } as JsonValue;
  }

  nextLayout[INPUT_FORMULAS_LAYOUT_KEY] = nextFormulaObject;
  return nextLayout;
}

export function setInputFormulaConfig(
  uiLayout: JsonObject,
  targetKey: string,
  config: InputFormulaConfig | null
): JsonObject {
  const current = readInputFormulaMap(uiLayout);
  const next = { ...current };
  if (!config) {
    delete next[targetKey];
  } else {
    next[targetKey] = config;
  }
  return writeInputFormulaMap(uiLayout, next);
}

export function tokenizeGraphFormula(expression: string): TokenizeResult {
  const tokens: GraphFormulaToken[] = [];
  const errors: string[] = [];
  let index = 0;

  const length = expression.length;
  while (index < length) {
    const char = expression[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ type: "operator", value: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "lparen", value: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "rparen", value: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      index += 1;
      while (index < length && /[A-Za-z0-9_]/.test(expression[index])) {
        index += 1;
      }
      tokens.push({ type: "identifier", value: expression.slice(start, index), start, end: index });
      continue;
    }

    if (/[0-9.]/.test(char)) {
      const start = index;
      let sawDigit = false;
      let sawDot = false;

      while (index < length) {
        const inner = expression[index];
        if (/[0-9]/.test(inner)) {
          sawDigit = true;
          index += 1;
          continue;
        }
        if (inner === ".") {
          if (sawDot) {
            break;
          }
          sawDot = true;
          index += 1;
          continue;
        }
        break;
      }

      const literal = expression.slice(start, index);
      if (!sawDigit || literal === ".") {
        errors.push(`Invalid number near '${literal}'.`);
      } else {
        tokens.push({ type: "number", value: literal, start, end: index });
      }
      continue;
    }

    errors.push(`Unsupported character '${char}' at position ${index + 1}.`);
    index += 1;
  }

  return { tokens, errors };
}

export function validateGraphFormulaExpression(
  expression: string,
  allowedIdentifiers: Set<string>
): GraphFormulaValidationResult {
  const trimmed = expression.trim();
  if (trimmed.length === 0) {
    return {
      isValid: false,
      errors: ["Formula is empty."],
      tokens: []
    };
  }

  const tokenized = tokenizeGraphFormula(expression);
  if (tokenized.errors.length > 0) {
    return {
      isValid: false,
      errors: tokenized.errors,
      tokens: tokenized.tokens
    };
  }

  const tokens = tokenized.tokens;
  let index = 0;
  const errors: string[] = [];

  const current = () => tokens[index];
  const next = () => tokens[index + 1];
  const consume = () => {
    index += 1;
  };

  const parseExpression = (): boolean => {
    if (!parseTerm()) {
      return false;
    }
    while (current()?.type === "operator" && (current()?.value === "+" || current()?.value === "-")) {
      consume();
      if (!parseTerm()) {
        errors.push("Expected expression after '+' or '-'.");
        return false;
      }
    }
    return true;
  };

  const parseTerm = (): boolean => {
    if (!parseFactor()) {
      return false;
    }
    while (current()?.type === "operator" && (current()?.value === "*" || current()?.value === "/")) {
      consume();
      if (!parseFactor()) {
        errors.push("Expected expression after '*' or '/'.");
        return false;
      }
    }
    return true;
  };

  const parseFactor = (): boolean => {
    const token = current();
    if (!token) {
      errors.push("Unexpected end of formula.");
      return false;
    }

    if (token.type === "operator" && (token.value === "+" || token.value === "-")) {
      consume();
      return parseFactor();
    }

    if (token.type === "number") {
      consume();
      return true;
    }

    if (token.type === "identifier") {
      if (next()?.type === "lparen") {
        const functionName = token.value;
        if (!GRAPH_FORMULA_UNARY_FUNCTION_SET.has(functionName)) {
          errors.push(`Unknown function '${functionName}'.`);
          return false;
        }
        consume();
        consume();
        if (!parseExpression()) {
          errors.push(`Expected expression inside '${functionName}(...)'.`);
          return false;
        }
        if (current()?.type !== "rparen") {
          errors.push(`Missing closing ')' for '${functionName}(...)'.`);
          return false;
        }
        consume();
        return true;
      }
      if (!allowedIdentifiers.has(token.value) && !GRAPH_FORMULA_LITERAL_IDENTIFIER_SET.has(token.value)) {
        errors.push(`Unknown input token '${token.value}'.`);
      }
      consume();
      return true;
    }

    if (token.type === "lparen") {
      consume();
      if (!parseExpression()) {
        return false;
      }
      if (current()?.type !== "rparen") {
        errors.push("Missing closing ')'.");
        return false;
      }
      consume();
      return true;
    }

    errors.push(`Unexpected token '${token.value}'.`);
    return false;
  };

  const parsed = parseExpression();
  if (parsed && index < tokens.length) {
    errors.push(`Unexpected token '${tokens[index].value}'.`);
  }

  return {
    isValid: parsed && errors.length === 0 && index >= tokens.length,
    errors,
    tokens
  };
}
