export function omitFixtureFields<T extends object, K extends keyof T>(
  value: T,
  ...keys: readonly K[]
): Omit<T, K> {
  const omitted = new Set(keys.map(String));
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !omitted.has(key)),
  ) as Omit<T, K>;
}
