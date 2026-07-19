export function omitObjectKeys<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  const result = { ...value };
  for (const key of keys) Reflect.deleteProperty(result, key);
  return result;
}
