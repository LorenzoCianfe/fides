/**
 * Interpolate `{name}` placeholders. Deliberately not a full ICU
 * implementation: the catalogue currently needs substitution only, and
 * pretending to support plurals we do not handle would be worse than not
 * offering them. An unknown placeholder is left as written rather than blanked,
 * so a missing value is visible instead of silently swallowed.
 */
export function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
