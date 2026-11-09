export function autoFill(form: Record<string, string>, saved: Record<string, string>): void {
  for (const k of Object.keys(saved)) form[k] ||= saved[k];
}
