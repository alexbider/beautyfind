// Dynamic route parameters arrive percent-encoded (a Hebrew slug reaches the page as "%D7%90..."), so
// every lookup by slug decodes first. A malformed sequence is kept as typed rather than thrown.
export function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
