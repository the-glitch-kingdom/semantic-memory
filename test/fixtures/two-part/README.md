# Two-part question reproduction for #91 (part 2)

18 docs and 2 questions, cut from the reporter's tree (about 590 active docs, every doc re-judged
against the code first) and anonymised.
- **Replaced:** company and product names, domains, the GitHub org and a contributor fork, people's
  names, a coach persona name, emails, IPs, a test password, database project refs and UUIDs.
- **Kept:** structure, headings, length and third-party vendor names.
- No index and no `.hewtd/graph.json` are included.

Both questions come from the reporter's **blind** set (written from code and git history by an agent
that never saw the docs). Facets are regexes taken from the code, one or more per part of the question.

## Questions

| id | parts | facets |
|---|---|---|
| R91-A | (1) how are an outside contributor's PRs limited to content, (2) what makes the check actually block a merge | `marketing-content`, `MARKETING_AUTHORS`, `REQUIRED status check` |
| R91-B | (1) what else is a deploy target, (2) how do I update it, (3) what must I never do there | `fetch origin main`, `SKIP_PULL`, `--no-deps`, `tailscale container` |

## Measured (1.31.0, cold build of this folder, no graph export)

`semantic-memory eval --notes docs --set questions.jsonl`:

| | hybrid | semantic |
|---|---|---|
| @1 | 0/2 | **1/2** |
| @3 | 1/2 | 1/2 |
| @8 | 1/2 | **2/2** |
| multi facet cov@3 / @8 | 0.63 / 0.88 | 0.63 / 1.00 |

The new Diagnosis labels both misses `ranking` (grep oracle @3 1/2).

### R91-A: the whole answer is in one chunk of one doc; hybrid demotes it below a doc with none of it

| rank | hybrid (score) | facets | section that matched | semantic rank |
|---|---|---|---|---|
| 1 | `knowledge-base/facts/cookie-custody-e2e-gate-self-skipped-on-wrong-probe-path.md` (0.5074) | 0/3 | "Lesson": a CI gate that silently skips is not a gate | 6 |
| **2** | **`marketing/seo-surface-implementation.md` (0.4791)** | **3/3** | **"The CI allowlist guard"** | **1** |
| 3 | `marketing/marketing-block-library.md` (0.4791) | 0/3 | "How to add a new block" | 5 |

- The winning doc's "CI allowlist guard" section holds all three facets in one chunk: the label, the
  author variable and "make it a required status check". Semantic alone ranks it **#1**.
- Hybrid puts a fact about a merge gate that self-skipped on top. It matches the *wording* of part 2
  ("actually block a merge") and answers neither part.
- On the full tree (live, 1.31.0, with a current graph export) the whole-answer doc is #2 as well, behind
  the block-library doc (0.5220 vs 0.5165).

### R91-B: three-part question; the two docs holding the commands rank 7 and below 10

| rank | hybrid | facets | semantic rank |
|---|---|---|---|
| 1 | `devops/environments-and-deploy-operator-notes.md` ("Deploy Procedures") | 0/4 | 3 |
| 2 | `devops/cloudflare-pages-deploy-workflow.md` | 0/4 | 2 |
| 3 | `standards/documentation/contributing.md` ("Deployment") | 1/4 | |
| 7 | `troubleshooting/email-deliverability.md` ("The deploy reported success and shipped nothing") | 3/4 | 4 |
| >10 | `devops/droplet-deployment.md` | 3/4 | 8 |

**Read this one with a caveat.** The #1 doc's "Deploy Procedures" section is a short operator summary
that answers all three parts in prose (the workers host is a separate deploy target, its deploy script
pulls itself, never `docker compose down` there), without the literal commands the facets check for.
The two docs that carry the commands (`SKIP_PULL`, `git fetch origin main`, `--no-deps`, the tailscale
container) rank 7 and outside the top 10 under hybrid, 4 and 8 under semantic. So R91-B is a mix:
partly ranking (hybrid is worse than semantic again), partly a summary doc legitimately answering in
paraphrase. It is useful for #91 as the "one summary doc vs the runbook with the steps" shape; it is
not a clean miss like R91-A.

On the full tree the order is the same (#1 operator notes, the 3/4 runbook #3).

## Run

From a copy of this folder:

```
semantic-memory --notes docs --reindex
semantic-memory eval --notes docs --set questions.jsonl
```

The subset reproduces the direction of the full tree on its own; exact ranks differ slightly from the
full tree because the corpus statistics are smaller.
