# What tardy is for

Tardy is a feed where **agents and humans both** keep up with AI development. It carries two kinds of content:

1. **Builders' own projects.** Status reels, launches, and side quests from people (and their agents) building with AI.
2. **General AI breakthroughs.** Model drops, papers, open-source releases, and whatever the field is talking about today.

Agents are first-class readers, not just posters: every surface a human can scroll should have an agent-readable equivalent (API, `llms.txt`, structured posts). Personal agent status updates are one input to the feed, not the whole product. Weigh both audiences and both sources when designing features, ranking, copy, or reels.

<!-- BEGIN MARBLES integration v0.1.0 profile:maintainer hash:2ce4c5 -->

## Marbles issue tracker

This project tracks work with `marbles` (`mb`). Issues, dependencies, and claims live in
the central Marbles server — never in markdown task lists, and never in a per-checkout
database that has to be synced.

### Quick reference

```bash
mb ready --json            # eligible work, already
mb claim <id> --as <who>   # take work (claims race safely; losing is normal)
mb touch <id>              # heartbeat a lease mid-work
mb review <id> --pr URL    # PR opened: work is under review, NOT done
mb close <id> --pr URL --commit SHA   # done means merged
mb close <id> --ack "no delivery expected: <reason>"  # research/coordination
```

The state machine is deliberately strict: `review` is what you set when a PR exists;
`closed` requires merge evidence (PR or commit) or an explicit acknowledgement that
none is expected. An agent that finished writing code has produced a review, not a
delivery.

Claims carry TTLs. Agent claims are minutes long and renewed by heartbeats; an expired
agent claim re-queues automatically. Human holds are business-hours long and, when they
lapse, escalate to the owner rather than silently re-queuing.

### Git hygiene (this fleet runs hot — non-negotiable)

- **Commit early, commit often.** Verified work lands as a local commit per intent,
referencing the marble id in the message (`mb show` it, mention it). Uncommitted
work is work that does not exist when your session dies.
- **No stale checkouts.** Rebase onto the base branch at claim time and before any
diff-dependent operation. A checkout older than four hours must rebase or be
discarded; never build on code you have not refreshed.
- **No dirty exits.** A session that ends with uncommitted changes either commits
them (preferred) or releases the claim with the state recorded via `mb touch` +
notes. A dirty tree with no live claim is a finding, not a to-do.
- **Claims serialize, pushes are separate authority.** Taking work is free and
atomic; opening PRs and pushing belongs to the delivery loop with the
host-held credential. An agent process never receives a push credential.
- **Release rather than hoard.** If you are done reading and not starting, `mb
release` beats holding. Expired-by-accident claims double the next agent's work.

<!-- END MARBLES INTEGRATION -->

<!-- BEGIN FPL DESIGN TENETS (managed by fpl) -->

# FPL Systems Design Tenets

These tenets apply across all FPL / Puget Audio codebases and automation. Every agent session (Claude Code, Codex, or otherwise) should treat these as load-bearing defaults, not suggestions — deviate only with an explicit, stated reason.

---

### 1. DRY (Don't Repeat Yourself)
One source of truth per fact. If the same schema, constant, or logic exists in two places, one of them is already wrong and just hasn't been noticed yet. Prefer a shared crate/module/service over copy-paste, even across repo boundaries in the FPL ecosystem (e.g. call `lob`'s Mouser integration — don't re-implement it in the workflow layer).

### 2. Loose Coupling
Modules and services talk through narrow, explicit interfaces — not shared internal state, not reaching into another project's guts. A project should be replaceable without its neighbors caring, as long as the interface contract holds. This is what keeps the "loose tools" (Quotron2, legion-of-bom, mesh-to-step, Panopticon, etc.) glueable instead of tangled.

### 3. Infer/Calculate Over Static/Configured (Good Dynamism)
Derive values from source-of-truth data at the point of use rather than hand-maintaining config that can drift out of sync. If a number can be computed from something else that already exists, compute it — don't cache a stale copy in a config file or constant.

### 4. Design Good Interfaces
Spend real thought on the boundary before implementing what's behind it. A good interface is boring, hard to misuse, and survives its internals being rewritten. Interfaces, persistence formats, and contracts are the genuine one-way doors — get these right up front even when you're moving fast on everything else.

### 5. Commit Early, Commit Often
Small, frequent, reversible commits. History should read as a trail of intent, not a single monolithic diff. This is what makes rollback, bisect, and review actually usable later. Agents are authorized to create local commits for completed, verified work by default; do not leave useful work uncommitted merely because a session is ending. An explicit instruction not to commit still wins. Pushing, merging, releasing, deploying, remote synchronization, and destructive history edits remain separately authorized operations.

### 6. Test Everything
No behavior ships un-verified. Tests are how a system stays trustworthy as an agent (human or LLM) keeps modifying it — they're the guardrail that lets you move fast without re-deriving correctness by hand every time.

### 7. Deterministic Orchestration, Narrow LLM-Assist
Workflows are discrete, deterministic, and reproducible by default (state machines, scripted flows) — not unstructured agent loops deciding what happens next. LLMs assist at specific, bounded points inside a workflow (drafting, scoring, summarizing), never as the thing deciding control flow. If the orchestrator's behavior can't be predicted from reading the code, it's not a workflow, it's a gamble.

### 8. Runbook Parity
Any automated workflow should still be describable as a manual runbook a human could execute if the automation broke. If you can't say "here's how a person would do this step by step," the workflow is probably hiding a business process you don't actually understand yet.

### 9. Self-Validating Over Human-Gated
Default to systems that catch their own mistakes, not systems that add a human review checkpoint. A review gate is a scaling liability disguised as a safety feature. Build the validation into the loop; don't outsource it to future-you's attention.

### 10. Call, Don't Rebuild
If a capability is already owned by another project in the ecosystem, invoke it as a tool — don't fork the logic into the caller. Ownership of a capability lives in exactly one place; everything else is a client of it.

### 11. Boring Technology, Deliberate Sprawl
New tools/services/dependencies earn their place — prefer the boring, already-adopted option over a novel one unless there's a concrete reason. Every new moving part is something that has to be audited, secured, and kept alive; unexamined sprawl is debt, not progress.

### 12. Fail Loud, Fail Fast
Errors surface immediately and visibly — no silent fallbacks, no swallowed exceptions, no "probably fine." A system that fails quietly just moves the cost of the bug to whoever debugs it in production three weeks later.

### 13. Cadence Beats Polish (Where Cadence Is the Point)
For anything whose value comes from consistency over time — content, reporting, outreach — a steady mediocre output beats a sporadic polished one. Save the polish budget for the genuine one-way doors (tenet #4); don't spend it gold-plating things that just need to keep showing up.

### 14. Rust First, Deliberate Language Boundaries
Rust is the primary preferred language for first-party implementation, including services, CLIs, tooling, data pipelines, and automation. Python is not an acceptable choice for new first-party implementations, including prototypes that become operational tools. C is allowed where justified, with narrow, carefully reviewed memory ownership and FFI boundaries, explicit safety contracts, and appropriate tests and sanitizers. Lua is allowed for embedded scripting through bounded host APIs, not as a general replacement for Rust services or tools. Other implementation languages require explicit user approval for a stated scope and reason; agent convenience is not an exception. Existing third-party tools and legacy systems are not a mandate for sweeping rewrites: keep interoperability explicit and scope migrations deliberately.

### 15. Cheapest Feedback That Answers the Question
`cargo check` is cheap for a reason — use it. Iterate on `check` while the work is still in motion, run `test` once the work is actually complete, and `build` only when a binary is genuinely needed. Running the expensive gate on every intermediate edit spends wall-clock to learn something the cheap gate already told you, and on a machine with concurrent agents it spends everyone else's too. The same ordering holds for any toolchain with a fast type-check tier: type-check while iterating, test at the end, produce artifacts last.

---

*Living document — extend as new patterns prove themselves, don't just accumulate opinions. If a tenet stops being true of how FPL actually builds things, cut it rather than let it rot into aspirational fiction.*

<!-- END FPL DESIGN TENETS -->
