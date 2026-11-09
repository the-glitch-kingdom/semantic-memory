import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkWikiLink from "remark-wiki-link";
import matter from "./matter.js";
import { glob } from "glob";
import { readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, relative, posix } from "node:path";
import type { IndexedDocument } from "./types.js";
import { buildFields, loadIndexFields, type IndexFields } from "./fields.js";
import { createHash } from "node:crypto";
import { flatSections } from "./sections.js";
import { isExcludedPath, loadPathClassConfig, type PathClassConfig } from "./path-class.js";

const DOCS_CACHE_FILE = "docs.cache.json";

// MiniLM's max_seq_length is 256 tokens (~4 chars each, less the heading trail): a longer chunk is mean-pooled over several topics, so a fact
// inside it is diluted. Measured on train (notes.md, Phase 5): windows of this size plus a sentence of overlap beat 2000-char chunks.
// shortcut: characters stand in for tokens (code and tables run denser, p95 ~300 tokens) and the size is not read from the model's config; revisit for a model with another window.
const CHUNK_TARGET_CHARS = 1000;
const MIN_SECTION_CHARS = 100; // a section shorter than this shares the chunk of the next one (tuned on train: 0-150 keep every answer section, 200+ merge neighbours of the section eval and lose it)

/** Bump when parsing or chunking output changes: caches re-parse (vectors are kept, they are keyed by chunk text). */
/** refs kept per section for the result's `code` field */
const SECTION_CODE_MAX = 3;
export const INDEX_SCHEMA_VERSION = 11; // 2: markdown links (mdLinks); 3: cites, archivedFrom; 4: path_class.exclude docs have no chunks; 5: field text, metadata chunks, generated docs; 6: gitDate (re-parse only, vectors are kept); 7: body-change gitDate, code/table/snake_case kept in chunk text (changed chunks re-embed); 8: codeRefs (re-parse only, chunk text unchanged); 9: chunks split at headings and prefixed with the heading trail (full re-embed), sections, chunkSection; 10: doc summary chunk (re-parse; only the new chunk embeds); 11: chunks of 1000 chars with a sentence of overlap (full re-embed)
export const CHUNKER = { targetChars: CHUNK_TARGET_CHARS };
/** One ignore list for the full index and for reconcile, so they always see the same files. */
export const IGNORE_GLOBS = ["**/node_modules/**"];

// follow: true descends into symlinked directories. Without this, users
// who symlink an external folder into their vault (a common pattern for
// sharing notes across projects) get silently empty indexing for the
// symlinked content. glob does cycle detection via visited inodes so
// circular symlinks are handled safely.
// Sorted: glob's order depends on I/O timing, and HNSW results depend on insertion order.
export async function listMarkdown(notesPath: string): Promise<string[]> {
  return (await glob("**/*.md", { cwd: notesPath, follow: true, ignore: IGNORE_GLOBS })).sort();
}

// Invalid YAML (e.g. an unquoted colon in a value) keeps the body searchable with empty frontmatter
export function parseFrontmatter(raw: string, file: string): { data: Record<string, unknown>; content: string } {
  try {
    return matter(raw);
  } catch (err: any) {
    process.stderr.write(`Invalid frontmatter in ${file}, indexing body only: ${err?.message?.split("\n")[0] ?? err}\n`);
    return { data: {}, content: raw.replace(/^---\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(\r?\n|$)/, "") };
  }
}

/**
 * One chunk that speaks for the whole doc (title, purpose, headings, first paragraph), embedded as a metadata chunk so a broad
 * question can win a hub doc that no single section answers. It scores like `purpose` (max of body and meta_weight x meta); the
 * excerpt, `section` and `anchor` still come from the doc's best body chunk. Measured in notes.md, Phase 5.
 */
function docSummary(title: string, purpose: unknown, headers: string[], plainText: string): string {
  const first = plainText.split(/\n{2,}/).map((p) => p.trim()).find((p) => p.length >= 40 && !headers.includes(p));
  return [title, typeof purpose === "string" ? purpose : "", headers.slice(0, 40).join(" | "), first?.slice(0, 500)].filter(Boolean).join("\n");
}

export class Indexer {
  private notesPath: string;
  private processor: any;
  private pathClass: PathClassConfig;
  private fields: IndexFields;

  constructor(notesPath: string) {
    this.notesPath = notesPath;
    this.pathClass = loadPathClassConfig(notesPath);
    this.fields = loadIndexFields(notesPath);
    this.processor = unified().use(remarkParse).use(remarkWikiLink);
  }

  async indexAll(): Promise<IndexedDocument[]> {
    const files = await listMarkdown(this.notesPath);
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
    const mdLinks = this.extractMarkdownLinks(tree, relativePath);
    const codeRefs = this.extractCodeRefs(tree, relativePath);
    const tags = this.extractTags(content, frontmatter);
    const headers = this.extractHeaders(tree);
    const plainText = this.stripMarkdown(content);
    const { chunks, sections, chunkSection } = this.sectionChunks(content, plainText, relativePath);

    // YAML parses `title: 2024` as a number and `title: 2024-05-01` as a Date
    const fmTitle = frontmatter.title as unknown;
    const title =
      (fmTitle instanceof Date ? fmTitle.toISOString().slice(0, 10) : Array.isArray(fmTitle) ? fmTitle.join(" ") : fmTitle == null ? "" : String(fmTitle)) ||
      headers[0] ||
      basename(relativePath, ".md");

    // excluded docs (archive by default) stay graph nodes so supersedes edges resolve; both kinds are never embedded or searched
    const generated = frontmatter.generated === true;
    const hidden = generated || isExcludedPath(relativePath, this.pathClass);
    const fields = hidden ? { lexical: "", meta: [] } : buildFields(frontmatter, title, this.fields);
    if (!hidden) fields.meta.push({ field: "doc", text: docSummary(title, frontmatter.purpose, headers, plainText) });

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

    // hewtd playbooks cite facts per symptom: `symptoms: [{ text, cites: [fact-id] }]`; a top-level `cites` is read too
    const citeSources: unknown[] = [
      ...(Array.isArray(frontmatter.symptoms) ? (frontmatter.symptoms as any[]).map((s) => s?.cites) : []),
      frontmatter.cites,
    ];
    const cites = [...new Set(citeSources.flatMap((c) => (Array.isArray(c) ? c : [])).filter((c): c is string => typeof c === "string" && c.length > 0))];
    const archivedFrom = typeof frontmatter.archived_from === "string" ? frontmatter.archived_from : undefined;

    return {
      path: relativePath,
      title,
      content: plainText,
      frontmatter,
      wikilinks,
      mdLinks,
      ...(codeRefs.length > 0 && { codeRefs }),
      tags,
      headers,
      chunks: hidden ? [] : chunks,
      ...(!hidden && { sections, chunkSection }),
      ...(fields.meta.length > 0 && { meta: fields.meta }),
      ...(fields.lexical && { fieldText: fields.lexical }),
      ...(generated && { generated }),
      mtime,
      ...(loadPriority !== undefined && { loadPriority }),
      ...(status !== undefined && { status }),
      ...(tier !== undefined && { tier }),
      ...(domains !== undefined && { domains }),
      ...(purpose !== undefined && { purpose }),
      ...(relatedDocs !== undefined && { relatedDocs }),
      ...(cites.length > 0 && { cites }),
      ...(archivedFrom !== undefined && { archivedFrom }),
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

  /**
   * Vault-relative `.md` targets of `[text](x.md)` links and link definitions. Walks the parsed tree, so links in
   * code blocks and images are never seen. External URLs, bare `#anchor`s, root-relative paths and links leaving
   * the vault are skipped; `#anchor`, `?query` and `%20` escapes are resolved away.
   */
  extractMarkdownLinks(tree: any, sourcePath: string): string[] {
    const out = new Set<string>();
    const walk = (node: any) => {
      if ((node.type === "link" || node.type === "definition") && typeof node.url === "string") {
        const url = node.url.split(/[#?]/)[0];
        if (url && !/^([a-z][a-z0-9+.-]*:|\/)/i.test(url)) {
          let decoded = url;
          try { decoded = decodeURIComponent(url); } catch { /* keep the raw text */ }
          const target = posix.normalize(posix.join(posix.dirname(sourcePath), decoded));
          if (target.endsWith(".md") && !target.startsWith("..")) out.add(target);
        }
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
    return [...out];
  }

  /**
   * What a doc says about code: inline code spans, and links to non-`.md` targets resolved from the doc's folder
   * (`../` kept, code lives outside the vault). Fenced blocks are skipped (too noisy). Spans are raw text; deciding
   * which are files or symbols needs the repo, so that is the code graph's job. shortcut: a span with spaces
   * (a command line) is dropped, not split into tokens.
   */
  extractCodeRefs(tree: any, sourcePath: string): string[] {
    const out = new Set<string>();
    const walk = (node: any) => {
      if (node.type === "inlineCode" && typeof node.value === "string") {
        const v = node.value.trim();
        if (v && v.length <= 120 && !/\s/.test(v)) out.add(v);
      } else if ((node.type === "link" || node.type === "definition") && typeof node.url === "string") {
        const url = node.url.split(/[#?]/)[0];
        if (url && !/^([a-z][a-z0-9+.-]*:|\/)/i.test(url)) {
          let decoded = url;
          try { decoded = decodeURIComponent(url); } catch { /* keep the raw text */ }
          const target = posix.normalize(posix.join(posix.dirname(sourcePath), decoded));
          if (!target.endsWith(".md") && target !== ".") out.add(target.replace(/\/$/, ""));
        }
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
    return [...out];
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
    if (node.type === "text" || node.type === "inlineCode") return node.value;
    if (node.children) return node.children.map((c: any) => this.nodeToText(c)).join("");
    return "";
  }

  /**
   * Plain text for BM25, search_text and embedding. Code is kept (fence lines dropped, backticks unwrapped) and table rows
   * become space-separated cells, so identifiers and values in them stay findable. `_` is stripped only at word edges
   * so snake_case and `a*b` survive; shortcut: `__init__` outside code loses its underscores like emphasis does.
   */
  private stripMarkdown(content: string): string {
    return content
      .replace(/^[ \t]*(`{3,}[^`\n]*|~~~.*)$/gm, "")
      .replace(/`([^`\n]+)`/g, "$1")
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[([^\]]+)\]\(.*?\)/g, "$1")
      .replace(/^\s*#{1,6}\s+/gm, "")
      .replace(/^[ \t]*\|[\s:|-]*\|?[ \t]*$/gm, "")
      .replace(/^[ \t]*\|.*\|[ \t]*$/gm, (row) => row.replace(/\s*\|\s*/g, " ").trim())
      .replace(/~~/g, "")
      .replace(/(?<![\p{L}\p{N}])[*_]+|[*_]+(?![\p{L}\p{N}])/gu, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*-{3,}\s*$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /**
   * Chunks split at headings, each prefixed with its heading trail ("Deploy > Rollback"); a section under MIN_SECTION_CHARS
   * is carried into the chunk of the next section. `chunkSection[i]` is the section chunk i answers for.
   */
  sectionChunks(content: string, plainText: string, sourcePath = ""): { chunks: string[]; sections: NonNullable<IndexedDocument["sections"]>; chunkSection: number[] } {
    const flat = flatSections(content);
    const stack: string[] = [];
    const sections = flat.map((s) => {
      stack.length = Math.max(0, s.level - 1);
      if (s.level > 0) stack[s.level - 1] = s.heading;
      const text = this.stripMarkdown(s.body);
      const code = this.extractCodeRefs(this.processor.parse(s.body), sourcePath).slice(0, SECTION_CODE_MAX);
      return { anchor: s.anchor, trail: stack.filter(Boolean).join(" > "), ...(code.length && { code }), hash: createHash("sha1").update(text.toLowerCase().replace(/\s+/g, " ")).digest("hex").slice(0, 16), text };
    });
    const chunks: string[] = [];
    const chunkSection: number[] = [];
    let carry = "";
    sections.forEach((sec, i) => {
      const text = [carry, sec.text].filter(Boolean).join("\n\n");
      carry = "";
      if (text.length < MIN_SECTION_CHARS && i < sections.length - 1) { carry = text; return; }
      if (!text) return;
      for (const c of this.chunkText(text)) {
        chunks.push(sec.trail ? `${sec.trail}\n${c}` : c);
        chunkSection.push(i);
      }
    });
    const strip = sections.map(({ text, ...s }) => s);
    if (chunks.length === 0) return { chunks: this.chunkText(plainText), sections: strip, chunkSection: [0] };
    return { chunks, sections: strip, chunkSection };
  }

  chunkText(text: string): string[] {
    if (text.length <= CHUNK_TARGET_CHARS) return [text];

    const sentences = text.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) || [text];
    const chunks: string[] = [];
    let current = "";
    let last = "";

    for (const sentence of sentences) {
      if (current.length + sentence.length > CHUNK_TARGET_CHARS && current) {
        chunks.push(current.trim());
        // a sentence of overlap, so a fact at a boundary sits whole in one chunk; skipped when it would crowd out the next sentence
        current = last.length + sentence.length <= CHUNK_TARGET_CHARS ? last : "";
      }
      current += sentence;
      last = sentence;
    }
    if (current.trim()) chunks.push(current.trim());

    return chunks;
  }
}
