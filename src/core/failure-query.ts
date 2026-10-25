/**
 * Turn a failed tool call (error text + command) into a search query for the fact that explains it
 * (v1.6). Error text is noisy — paths, ids, timestamps, hex, stack frames — and fact titles are prose,
 * so the raw text matches poorly. Keep what identifies the trap: the error lines, the error class,
 * the exit code, and the program/subcommand that was run. Pure.
 */

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const NOISE: [RegExp, string | ((match: string) => string)][] = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, " "], // uuid
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?\b/g, " "], // timestamp
  [/\b\d{1,2}:\d{2}:\d{2}(\.\d+)?\b/g, " "], // clock time
  [/\b(?:0x)?[0-9a-f]{7,}\b/gi, " "], // hashes, addresses
  [/\bhttps?:\/\/([^/\s:]+)\S*/g, " $1 "], // URL → host
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, " "], // IPv4[:port]
  [/(?:~|\.{1,2})?(?:\/[\w.@+-]+){2,}\/?/g, (m) => ` ${m.replace(/\/$/, "").split("/").pop()} `], // path → basename
  [/\[REDACTED\]/g, " "],
  [/\b\d{5,}\b/g, " "], // long numbers (pids, ports, sizes)
];

const SIGNAL = /error|exception|fail|denied|not found|no such|cannot|can't|invalid|refused|timed? ?out|fatal|unable|missing|unknown|unexpected|forbidden|unauthori[sz]ed|conflict|exit code|exited|traceback|panic|abort|killed|not allowed|permission/i;

function clean(text: string): string {
  let out = text.replace(ANSI, "");
  for (const [re, rep] of NOISE) out = typeof rep === "string" ? out.replace(re, rep) : out.replace(re, rep);
  // tidy what the removals leave: "config.yaml : x" → "config.yaml: x", "( , )" → ""
  return out.replace(/[ \t]+/g, " ").replace(/ ([:,;.)\]])/g, "$1").replace(/\(\s*[,\s]*\)/g, "").trim();
}

/** Error lines worth searching on: the ones that say what went wrong, deduped, capped. */
export function errorSignal(error: string, maxChars = 400): string {
  const lines = clean(error)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && !/^\s*at\s/.test(l) && !/^File ".*", line \d+/.test(l)); // stack frames
  const signal = lines.filter((l) => SIGNAL.test(l));
  const picked = [...new Set(signal.length > 0 ? signal : lines.slice(0, 3))];
  let out = "";
  for (const l of picked) {
    if (out.length + l.length > maxChars) break;
    out += (out ? "\n" : "") + l;
  }
  return out || (picked[0] ?? "").slice(0, maxChars);
}

/** Program + first subcommand of each segment of a shell command: `cd x && git push -f` → `git push`. */
export function commandVerbs(command: string): string {
  const verbs: string[] = [];
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment
      .trim()
      .split(/\s+/)
      .filter((w) => w && !/^\w+=/.test(w)); // drop env assignments
    if (words.length === 0) continue;
    const prog = words[0].split("/").pop()!;
    if (["cd", "echo", "true", "sleep", "export", "set", "source", "."].includes(prog)) continue;
    // up to two following plain words or short flags: `git push origin`, `pkill -f`, `python3 -m pytest`
    const args: string[] = [];
    for (const w of words.slice(1)) {
      if (!/^(-[A-Za-z]|[a-z][\w:-]{0,29})$/i.test(w)) break;
      args.push(w);
      if (args.length === 2) break;
    }
    verbs.push([prog, ...args].join(" "));
  }
  return [...new Set(verbs)].slice(0, 4).join(", ");
}

export function failureQuery(error: string, command: string): string {
  const verbs = commandVerbs(command ?? "");
  const signal = errorSignal(error ?? "");
  return [verbs, signal].filter(Boolean).join(": ");
}
