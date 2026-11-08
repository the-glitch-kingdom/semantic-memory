/**
 * "Top-3 docs citing no missing references" (semantic-memory#58 check 4): over the answerable questions, the mean share of each top-k
 * whose docs cite no missing file (`dead`: vault paths of docs with a dead reference), and the number of questions whose whole top-k is clean.
 */
export function cleanTopK(tops: string[][], dead: Set<string>, k = 3): { share: number; allClean: number; n: number } {
  let share = 0, allClean = 0;
  for (const top of tops) {
    const t = top.slice(0, k);
    const clean = t.filter((p) => !dead.has(p)).length;
    share += t.length ? clean / t.length : 1;
    if (clean === t.length) allClean++;
  }
  return { share: tops.length ? share / tops.length : 1, allClean, n: tops.length };
}
