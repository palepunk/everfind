export type QueryCondition =
  | { type: 'where'; field: string; operator: 'eq'; value: unknown }
  | { type: 'where'; field: string; operator: 'notEq'; value: unknown }
  | { type: 'where'; field: string; operator: 'oneOf'; values: unknown[] }
  | { type: 'sortBy'; field: string; direction: 'asc' | 'desc' }
  | { type: 'take'; count: number };

export const Q = {
  where(field: string, value: unknown): QueryCondition {
    if (value && typeof value === 'object' && (value as any).type === 'oneOf') {
      return { type: 'where', field, operator: 'oneOf', values: (value as any).values };
    }
    if (value && typeof value === 'object' && (value as any).type === 'notEq') {
      return { type: 'where', field, operator: 'notEq', value: (value as any).value };
    }
    return { type: 'where', field, operator: 'eq', value };
  },
  oneOf(values: unknown[]) {
    return { type: 'oneOf', values };
  },
  notEq(value: unknown) {
    return { type: 'notEq', value };
  },
  sortBy(field: string, direction: 'asc' | 'desc' = 'asc'): QueryCondition {
    return { type: 'sortBy', field, direction };
  },
  take(count: number): QueryCondition {
    return { type: 'take', count };
  },
  asc: 'asc' as const,
  desc: 'desc' as const,
};
