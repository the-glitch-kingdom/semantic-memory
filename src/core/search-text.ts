import type { IndexedDocument, SearchResult, SearchTextOptions } from "./types.js";
import { minimatch } from "minimatch";

export class TextSearch {
  private documents: IndexedDocument[] = [];

  setDocuments(documents: IndexedDocument[]): void {
    this.documents = documents;
  }

  search(options: SearchTextOptions): SearchResult[] {
    const { pattern, regex, caseSensitive, pathGlob, tagFilter, limit = 20 } = options;

    let matcher: (text: string) => { count: number; index: number };

    if (regex) {
      const re = new RegExp(pattern, caseSensitive ? "g" : "gi");
      matcher = (text) => {
        const all = [...text.matchAll(re)];
        return { count: all.length, index: all[0]?.index ?? -1 };
      };
    } else {
      const needle = caseSensitive ? pattern : pattern.toLowerCase();
      matcher = (text) => {
        const haystack = caseSensitive ? text : text.toLowerCase();
        const idx = haystack.indexOf(needle);
        let count = 0;
        for (let i = idx; i >= 0 && needle; i = haystack.indexOf(needle, i + needle.length)) count++;
        return { count, index: idx };
      };
    }

    const results: (SearchResult & { density: number })[] = [];

    for (const doc of this.documents) {
      // Path filter
      if (pathGlob && !minimatch(doc.path, pathGlob)) continue;

      // Tag filter
      if (tagFilter?.length) {
        const hasTag = tagFilter.some((t) => doc.tags.includes(t));
        if (!hasTag) continue;
      }

      const { count, index } = matcher(doc.content);
      if (count === 0) continue;

      const snippetStart = Math.max(0, index - 80);
      const snippetEnd = Math.min(doc.content.length, index + 120);
      const snippet = doc.content.slice(snippetStart, snippetEnd).trim();

      results.push({
        path: doc.path,
        title: doc.title,
        score: count,
        density: count / Math.max(doc.content.length, 1),
        snippet: (snippetStart > 0 ? "..." : "") + snippet + (snippetEnd < doc.content.length ? "..." : ""),
      });
    }

    // Most matches first; the tie goes to the denser (shorter-for-the-same-count) doc, BM25's length normalisation.
    results.sort((a, b) => b.score - a.score || b.density - a.density || a.path.localeCompare(b.path));
    return results.slice(0, limit).map(({ density: _d, ...r }) => r);
  }
}
