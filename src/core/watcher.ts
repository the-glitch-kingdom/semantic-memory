import { watch, type FSWatcher } from "chokidar";
import { EventEmitter } from "node:events";

export interface WatcherEvents {
  changed: (paths: string[]) => void;
  error: (error: Error) => void;
}

const IGNORED_DIRS = /(^|[\\/])(node_modules|\.semantic-sidekick-index|\.git)([\\/]|$)/;
const isMarkdown = (path: string) => path.endsWith(".md");

export class Watcher extends EventEmitter {
  private notesPath: string;
  private fsWatcher: FSWatcher | null = null;
  private debounceMs: number;
  private pendingChanges = new Set<string>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readyPromise: Promise<void> | null = null;
  private usePolling: boolean;

  constructor(notesPath: string, debounceMs: number = 500, usePolling: boolean = false) {
    super();
    this.notesPath = notesPath;
    this.debounceMs = debounceMs;
    this.usePolling = usePolling;
  }

  start(): void {
    if (this.fsWatcher) return;

    // chokidar ≥4 has no glob support: watch the folder and filter (a "**/*.md" target never fires)
    this.fsWatcher = watch(".", {
      cwd: this.notesPath,
      ignoreInitial: true,
      followSymlinks: true,
      ignored: (path, stats) => IGNORED_DIRS.test(path) || (stats?.isFile() === true && !isMarkdown(path)),
      ...(this.usePolling ? { usePolling: true, interval: 100 } : {}),
    });

    this.readyPromise = new Promise<void>((resolve) => {
      this.fsWatcher!.on("ready", resolve);
    });

    this.fsWatcher.on("add", (path) => this.enqueue(path));
    this.fsWatcher.on("change", (path) => this.enqueue(path));
    this.fsWatcher.on("unlink", (path) => this.enqueue(path));
    this.fsWatcher.on("error", (err) => this.emit("error", err));
  }

  async ready(): Promise<void> {
    if (this.readyPromise) await this.readyPromise;
  }

  stop(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.fsWatcher?.close();
    this.fsWatcher = null;
    this.pendingChanges.clear();
  }

  private enqueue(path: string): void {
    // `ignored` gets no stats for some events (e.g. unlink), so non-markdown can reach here
    if (!isMarkdown(path)) return;
    this.pendingChanges.add(path);

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const paths = [...this.pendingChanges];
      this.pendingChanges.clear();
      this.emit("changed", paths);
    }, this.debounceMs);
  }
}
