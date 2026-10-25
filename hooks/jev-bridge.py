#!/usr/bin/env python3
"""semantic-memory → Jev, through jev-loop's router (v1.7 jev mode). Stdlib only.

    echo '{"cwd": "...", "caller": "semantic-memory-judge", "state": "...",
           "questions": [{"key": "a", "instructions": "..."}]}' | python3 jev-bridge.py

Prints one JSON line: {"scores": {key: probability}, "tokens": n} or {"scores": {}, "error": "..."}.
Never raises, never exits non-zero: every failure is an empty answer with a reason.

The only way semantic-memory reaches TypeSafe is `router.ask`, which redacts the state and every
question (redact.py), caches answers, writes the usage ledger under the caller's name and enforces the
batch budget. This file never builds a request itself and never prints the key.

Callers: semantic-memory-hook (live: the failure hook; counted, never capped by jev-loop, no cache read)
and semantic-memory-judge / semantic-memory-skill-loop (batch: capped and cached). The live caller has
its own daily ceiling here, SEMANTIC_MEMORY_JEV_DAILY_TOKENS (default 500000).
"""
import json
import os
import sys
from datetime import datetime
from pathlib import Path

CALLERS = {"semantic-memory-hook", "semantic-memory-judge", "semantic-memory-skill-loop"}
LIVE_CALLER = "semantic-memory-hook"


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def live_tokens_today(logs, caller):
    """Tokens this caller spent today, from jev-loop's usage ledger (numbers only)."""
    day, used = datetime.now().date().isoformat(), 0
    for path in Path(logs).glob("jev-usage-*.jsonl"):
        for line in path.read_text().splitlines():
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get("caller") == caller and str(r.get("time", "")).startswith(day):
                used += r.get("input_tokens", 0) + r.get("output_tokens", 0)
    return used


def main():
    try:
        req = json.loads(sys.stdin.read() or "{}")
    except ValueError as e:
        return out({"scores": {}, "error": f"bad input: {e}"})
    caller = req.get("caller")
    if caller not in CALLERS:
        return out({"scores": {}, "error": f"unknown caller {caller!r}"})
    state, questions = req.get("state"), req.get("questions") or []
    if not isinstance(state, str) or not state or not questions:
        return out({"scores": {}, "error": "state and questions are required"})
    if not all(isinstance(q, dict) and q.get("key") and isinstance(q.get("instructions"), str) for q in questions):
        return out({"scores": {}, "error": "each question needs a key and instructions"})

    jev_dir = Path(os.environ.get("JEV_LOOP_DIR") or Path.home() / ".claude" / "jev-loop")
    if not (jev_dir / "router.py").exists():
        return out({"scores": {}, "error": f"jev-loop not found at {jev_dir}"})
    if not os.environ.get("TYPESAFE_API_KEY"):
        # cron and plain shells have no Claude settings env: read the key the way jev-loop's daily.sh does
        try:
            settings = Path(os.environ.get("SEMANTIC_MEMORY_CLAUDE_SETTINGS") or Path.home() / ".claude" / "settings.json")
            os.environ["TYPESAFE_API_KEY"] = json.loads(settings.read_text())["env"]["TYPESAFE_API_KEY"]
        except Exception:
            return out({"scores": {}, "error": "TYPESAFE_API_KEY is not set"})

    # the router names its caller from argv[0] (older jev-loop) or JEV_CALLER: set both before importing it
    os.environ["JEV_CALLER"] = caller
    sys.argv = [caller]
    sys.path.insert(0, str(jev_dir))
    try:
        import router  # noqa: E402
    except Exception as e:
        return out({"scores": {}, "error": f"router import failed: {type(e).__name__}: {e}"})

    cwd = req.get("cwd") or os.getcwd()
    if router.repo_for(cwd, []) == "excluded":
        return out({"scores": {}, "error": "excluded path: nothing sent"})

    if caller == LIVE_CALLER:
        cap = int(os.environ.get("SEMANTIC_MEMORY_JEV_DAILY_TOKENS") or 500_000)
        used = live_tokens_today(router.LOGS, caller)
        if used >= cap:
            return out({"scores": {}, "error": f"daily ceiling reached: {used} of {cap} tokens (SEMANTIC_MEMORY_JEV_DAILY_TOKENS)", "ceiling": True})
    timeout = req.get("timeout_seconds")
    if isinstance(timeout, (int, float)) and timeout > 0:
        router.R["timeout_seconds"] = timeout

    state = state[: router.R["max_prompt_chars"]]
    items = [(q["key"], q["instructions"]) for q in questions]
    try:
        scores, tokens = router.ask_all(state, items)
    except Exception as e:  # JevBudget, HTTP errors, timeouts: no answer, never a crash
        router.flush_ledger()
        return out({"scores": {}, "error": f"{type(e).__name__}: {e}"[:300]})
    router.flush_ledger()
    out({"scores": {k: v for k, v in scores.items() if isinstance(v, (int, float))}, "tokens": tokens})


if __name__ == "__main__":
    try:
        main()
    except BaseException as e:  # noqa: BLE001 — the bridge must never crash its caller
        out({"scores": {}, "error": f"{type(e).__name__}: {e}"[:300]})
