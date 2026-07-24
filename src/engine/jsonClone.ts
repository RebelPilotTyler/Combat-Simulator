const omittedJsonProperty = Symbol('omitted-json-property');

/**
 * Clones JSON-compatible engine data without allocating an intermediate JSON
 * string. The conversion rules intentionally match JSON.stringify/JSON.parse
 * for the values that can appear in combat and encounter state.
 */
export function cloneJsonValue<T>(value: T): T {
  const cloned = cloneJsonValueInternal(value, new Set<object>(), false);
  if (cloned === omittedJsonProperty) {
    throw new SyntaxError('Cannot clone a value that has no JSON representation.');
  }
  return cloned as T;
}

function cloneJsonValueInternal(
  value: unknown,
  ancestors: Set<object>,
  arrayItem: boolean
): unknown | typeof omittedJsonProperty {
  if (value === null) {
    return null;
  }

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
    case 'undefined':
    case 'function':
    case 'symbol':
      return arrayItem ? null : omittedJsonProperty;
    case 'bigint':
      throw new TypeError('BigInt values cannot be serialized as JSON.');
    case 'object':
      break;
  }

  if (ancestors.has(value)) {
    throw new TypeError('Converting circular structure to JSON.');
  }

  ancestors.add(value);
  try {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') {
      return cloneJsonValueInternal(toJSON.call(value), ancestors, arrayItem);
    }

    if (value instanceof Number || value instanceof String || value instanceof Boolean) {
      return cloneJsonValueInternal(value.valueOf(), ancestors, arrayItem);
    }

    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const item = cloneJsonValueInternal(value[index], ancestors, true);
        result.push(item === omittedJsonProperty ? null : item);
      }
      return result;
    }

    const result: Record<string, unknown> = {};
    Object.keys(value).forEach((key) => {
      const property = cloneJsonValueInternal((value as Record<string, unknown>)[key], ancestors, false);
      if (property !== omittedJsonProperty) {
        result[key] = property;
      }
    });
    return result;
  } finally {
    ancestors.delete(value);
  }
}
