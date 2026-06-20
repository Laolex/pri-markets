// Normalizes the many shapes an error can arrive in (viem/wagmi attach a terse
// `shortMessage`; plain Errors have `message`; some throws are strings) into one
// human-readable string. Replaces the copy-pasted `e.shortMessage ?? e.message ?? String(e)`
// boilerplate scattered across the write hooks.
export function getErrMsg(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { shortMessage?: string; message?: string };
    if (typeof o.shortMessage === "string" && o.shortMessage) return o.shortMessage;
    if (typeof o.message === "string" && o.message) return o.message;
  }
  return String(e);
}
