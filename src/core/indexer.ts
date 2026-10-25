import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkWikiLink from "remark-wiki-link";
import matter from "./matter.js";
import { glob } from "glob";
import { readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { IndexedDocument } from "./types.js";

const DOCS_CACHE_FILE = "docs.cache.json";

const CHUNK_TARGET_CHARS = 2000; // ~512 tokens

// Invalid YAML (e.g. an unquoted colon in a value) keeps the body searchable with empty frontmatter
function parseFrontmatter(raw: string, file: string): { data: Record<string, unknown>; content: string } {
  try {
    return matter(raw);
  } catch (err: any) {
    process.stderr.write(`Invalid frontmatter in ${file}, indexing body only: ${err?.message?.split("\n")[0] ?? err}\n`);
    return { data: {}, content: raw.replace(/^---\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(\r?\n|$)/, "") };
  }
}

export class Indexer {
  private notesPath: string;
  private processor: any;

  constructor(notesPath: string) {
    this.notesPath = notesPath;
    this.processor = unified().use(remarkParse).use(remarkWikiLink);
  }

  async indexAll(): Promise<IndexedDocument[]> {
    // follow: true descends into symlinked directories. Without this, users
    // who symlink an external folder into their vault (a common pattern for
    // sharing notes across projects) get silently empty indexing for the
    // symlinked content. glob does cycle detection via visited inodes so
    // circular symlinks are handled safely.
    const files = await glob("**/*.md", { cwd: this.notesPath, follow: true });
    // One unreadable file must not take the whole corpus down with it
    const docs = await Promise.all(
      files.map((file) =>
        this.indexFile(join(this.notesPath, file), file).catch((err) => {
          process.stderr.write(`Skipping ${file}: ${err?.message ?? err}\n`);
          return null;
        })
      )
    );
    return docs.filter((d): d is IndexedDocument => d !== null);
  }

  /**
   * Load parsed-doc cache from disk. Returns null if missing or unreadable.
   * The cache is a verbatim JSON dump of a prior indexAll() result, written by
   * saveDocsCache. Consumers (search CLI / hook path) prefer this over re-parsing
   * 500+ markdown files; the tradeoff is that cache may be stale if the vault
   * changed since the last reindex — same staleness window as the vector cache.
   */
  async loadDocsCache(indexPath: string): Promise<IndexedDocument[] | null> {
    const p = join(indexPath, DOCS_CACHE_FILE);
    if (!existsSync(p)) return null;
    try {
      const raw = await readFile(p, "utf-8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return parsed as IndexedDocument[];
    } catch {
      return null;
    }
  }

  async saveDocsCache(indexPath: string, docs: IndexedDocument[]): Promise<void> {
    const p = join(indexPath, DOCS_CACHE_FILE);
    await writeFile(p, JSON.stringify(docs), "utf-8");
  }

  async indexFile(
    absolutePath: string,
    relativePath: string
  ): Promise<IndexedDocument> {
    const [raw, fileStat] = await Promise.all([
      readFile(absolutePath, "utf-8"),
      stat(absolutePath),
    ]);
    const { data: frontmatter, content } = parseFrontmatter(raw, relativePath);
    const tree = this.processor.parse(content);

    const wikilinks = this.extractWikilinks(tree);
    const tags = this.extractTags(content, frontmatter);
    const headers = this.extractHeaders(tree);
    const plainText = this.stripMarkdown(content);
    const chunks = this.chunkText(plainText);

    // Symptom-keyed indexing (v1.4 Phase 5). Each verbatim `symptoms:` phrase is
    // added as its own chunk, so a terse symptom query ("it hangs after reindex")
    // matches the note directly — the fix for asymmetric retrieval (query-shaped
    // keys stored alongside document-shaped content). Synthetic child chunks point
    // at the same note path; no index-format change.
    const symptoms = Array.isArray(frontmatter.symptoms)
      ? (frontmatter.symptoms as unknown[]).filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim())
      : [];
    const allChunks = symptoms.length > 0 ? [...chunks, ...symptoms] : chunks;

    const title =
      (frontmatter.title as string) ||
      headers[0] ||
      basename(relativePath, ".md");

    // Resolve modification time: prefer frontmatter date fields over fs.stat
    // Supports hit-em-with-the-docs (last_updated) and common alternatives
    const mtime = this.resolveMtime(frontmatter, fileStat.mtime);

    // Optional hit-em-with-the-docs fields (only populated when present)
    const loadPriority =
      typeof frontmatter.load_priority === "number"
        ? Math.min(10, Math.max(1, frontmatter.load_priority))
        : undefined;
    const status =
      typeof frontmatter.status === "string" ? frontmatter.status : undefined;
    const tier =
      typeof frontmatter.tier === "string" ? frontmatter.tier : undefined;
    const domains = Array.isArray(frontmatter.domains)
      ? (frontmatter.domains as string[])
      : undefined;
    const purpose =
      typeof frontmatter.purpose === "string" ? frontmatter.purpose : undefined;
    const relatedDocs = Array.isArray(frontmatter.related_docs)
      ? (frontmatter.related_docs as string[]).filter((v) => typeof v === "string")
      : undefined;

    return {
      path: relativePath,
      title,
      content: plainText,
      frontmatter,
      wikilinks,
      tags,
      headers,
      chunks: allChunks,
      mtime,
      ...(loadPriority !== undefined && { loadPriority }),
      ...(status !== undefined && { status }),
      ...(tier !== undefined && { tier }),
      ...(domains !== undefined && { domains }),
      ...(purpose !== undefined && { purpose }),
      ...(relatedDocs !== undefined && { relatedDocs }),
    };
  }

  /**
   * Resolve the best available modification date for a document.
   * Priority: last_updated → updated → date → lastmod → fs.stat mtime
   * Accepts YYYY-MM-DD strings or full ISO timestamps.
   */
  private resolveMtime(
    frontmatter: Record<string, unknown>,
    statMtime: Date
  ): string {
    const candidates = [
      frontmatter.last_updated,
      frontmatter.updated,
      frontmatter.date,
      frontmatter.lastmod,
    ];
    for (const val of candidates) {
      if (!val) continue;
      const str = val instanceof Date ? val.toISOString() : String(val);
      const parsed = new Date(str);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return statMtime.toISOString();
  }

  private extractWikilinks(tree: any): string[] {
    const links: string[] = [];
    const walk = (node: any) => {
      if (node.type === "wikiLink") {
        links.push(node.value || node.data?.alias || "");
      }
      if (node.children) {
        for (const child of node.children) walk(child);
      }
    };
    walk(tree);
    return [...new Set(links.filter(Boolean))];
  }

  private extractTags(content: string, frontmatter: Record<string, unknown>): string[] {
    const inlineTags = [...content.matchAll(/(?:^|\s)#([a-zA-Z][\w-/]*)/g)].map(
      (m) => m[1]
    );

    const fmTags = Array.isArray(frontmatter.tags)
      ? (frontmatter.tags as string[])
      : [];

    return [...new Set([...fmTags, ...inlineTags])];
  }

  private extractHeaders(tree: any): string[] {
    const headers: string[] = [];
    const walk = (node: any) => {
      if (node.type === "heading") {
        const text = this.nodeToText(node);
        if (text) headers.push(text);
      }
      if (node.children) {
        for (const child of node.children) walk(child);
      }
    };
    walk(tree);
    return headers;
  }

  private nodeToText(node: any): string {
    if (node.type === "text") return node.value;
    if (node.children) return node.children.map((c: any) => this.nodeToText(c)).join("");
    return "";
  }

  private stripMarkdown(content: string): string {
    return content
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`]+`/g, "")
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[([^\]]+)\]\(.*?\)/g, "$1")
      .replace(/#{1,6}\s+/g, "")
      .replace(/[*_~]{1,3}/g, "")
      .replace(/>\s+/g, "")
      .replace(/\|.*\|/g, "")
      .replace(/-{3,}/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  chunkText(text: string): string[] {
    if (text.length <= CHUNK_TARGET_CHARS) return [text];

    const sentences = text.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) || [text];
    const chunks: string[] = [];
    let current = "";

    for (const sentence of sentences) {
      if (current.length + sentence.length > CHUNK_TARGET_CHARS && current) {
        chunks.push(current.trim());
        current = "";
      }
      current += sentence;
    }
    if (current.trim()) chunks.push(current.trim());

    return chunks;
  }
}
