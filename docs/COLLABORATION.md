# Working on Omni with more than one person

How a second contributor joins this repo, what they can do on their own, and
what needs the owner's sign-off.

Audience: the repo owner setting this up, and any new collaborator (human or
driving Claude Code) reading in for the first time.

**Read `CLAUDE.md` first.** It is the spec for how this codebase actually
works and it is kept current. This file only covers *process*.

---

## 1. Roles

| Role | Who | GitHub permission | Can merge to `main`? |
| --- | --- | --- | --- |
| Owner | `@I-R0N` | Admin | Yes |
| Assistant | new collaborator | Write (see §3) | **No — approval required** |

The rule this repo runs on: **anyone may open a pull request; only the owner
merges it.** Nothing lands on `main` without an explicit owner approval.

---

## 2. The plan constraint (read before configuring anything)

`I-R0N/Omni` is a **private repository on a personal account**. GitHub gates
the features that would enforce the rule above:

- **Protected branches / rulesets** — public repos on Free; private repos need
  **GitHub Pro**, Team, or Enterprise.
- **CODEOWNERS** — same gating: public repos on Free; private repos need Pro.

So on a Free plan, a private repo has **no way to technically block a merge**.
A collaborator with Write access can push to `main` and can click Merge. Pick
one of these:

### Option A — GitHub Pro (recommended)

About $4/month. Turns on real branch protection and makes `.github/CODEOWNERS`
live. Give the assistant Write access, configure §4, done. This is the least
friction for the smallest cost and it keeps the preview workflow working
exactly as it does today.

### Option B — fork-based, stays on Free

Give the assistant **Read** access only. They fork the repo, push branches to
their fork, and open PRs across. They physically cannot push to `main` or merge,
with no paid plan and no branch protection.

The cost: `.github/workflows/pr-preview.yml` deliberately skips fork PRs
(`if: github.event.pull_request.head.repo.full_name == github.repository`)
because forks cannot read secrets — so **fork PRs get no githack preview
link**. `.github/workflows/ci.yml` still runs (it needs no secrets), so the
build is still gated. Restoring previews for forks means splitting the preview
job into an untrusted build + a `workflow_run` publish step that holds the
secret. That is a real change and has not been made.

### Option C — convention only, stays on Free

Write access, no enforcement, the rule lives in `CLAUDE.md` and in this file.
Both contributors drive Claude Code, which reads `CLAUDE.md` every session, so
the agent will not self-merge. Fine for a high-trust pair; it is a guardrail,
not a gate. A stray click still merges.

**Recommendation: Option A.** Option C is a reasonable stopgap. Option B is
only worth it if paying is off the table *and* losing preview links on the
assistant's PRs is acceptable — which, given previews are the main review
mechanism here, it probably is not.

---

## 3. Granting access

1. **Invite the collaborator.**
   `Settings → Collaborators → Add people`. Permission level per §2:
   **Write** for Option A or C, **Read** for Option B.

2. **Give them the preview mirror too, if relevant.** Previews are published
   to the separate public repo `i-r0n/omni-standalone`. The assistant does not
   need access to it to read a preview link, only to debug the publish step.

3. **Claude Code access.** The assistant runs Claude Code against this repo
   under their own Claude account. The Claude GitHub App must be able to see
   `I-R0N/Omni`, and the assistant must be a collaborator on it. If the repo
   does not appear in their repo picker, check the app's repository access in
   the owner's GitHub settings — for a Slack/web session the pointer is
   <https://claude.ai/admin-settings/claude-in-slack>.

4. **Point them at `CLAUDE.md`.** It is the highest-leverage thing a new
   contributor (or their agent) can read.

### A note on trust

Under Option A/C the assistant has Write access, which means they can edit
`.github/workflows/`. For a same-repo pull request GitHub runs the workflow
file *from the PR branch*, with secrets available — so a workflow edit is a
path to `OMNI_STANDALONE_TOKEN`. That is normal for a trusted collaborator and
is not a reason to avoid Write access; just review workflow diffs with the same
attention as engine diffs. `.github/CODEOWNERS` lists `/.github/` explicitly
for this reason.

---

## 4. Configuring the approval gate (Options A only)

`Settings → Rules → Rulesets → New branch ruleset` (or the older
`Settings → Branches → Add branch protection rule`).

Target: the **default branch** (`main`).

Enable:

- **Require a pull request before merging**
  - Required approvals: **1**
  - **Dismiss stale pull request approvals when new commits are pushed** — on.
    Important here: agent-driven PRs get pushed to repeatedly after review.
  - **Require review from Code Owners** — on. Pairs with `.github/CODEOWNERS`,
    which makes `@I-R0N` the required reviewer on every path.
- **Require status checks to pass before merging**
  - Require branches to be up to date before merging — on.
  - Required check: **`build`** (the job in `.github/workflows/ci.yml`).
    Do *not* require the `preview` job — it depends on a deploy secret and on
    a second repository, so making it a merge gate couples merging to the
    mirror being healthy.
- **Block force pushes** — on.
- **Restrict deletions** — on.

Leave **"Do not allow bypassing the above settings"** *off* so the owner keeps
an admin escape hatch, or turn it on if you want the rule to bind the owner
too. Either is defensible; off is the pragmatic default for a two-person repo.

Because a PR author cannot approve their own pull request, "1 required
approval" is exactly the rule you want: the assistant's PRs need the owner, and
the owner's own PRs are self-merged via the admin bypass (or reviewed by the
assistant, if you prefer symmetry).

---

## 5. Day-to-day workflow

Both contributors work the same way — the flow this repo already uses.

1. **Branch off `main`.** Claude Code generates `claude/<feature>-<suffix>`
   branches with a random suffix, so two agents will not collide. Attribution
   comes from the PR author, not the branch name.
2. **Build before pushing.** `npm run build` is the last-mile validation
   (see §7 for what it does *not* catch). There is no test runner or linter in
   this repo — do not add one without asking.
3. **Open a pull request** against `main`. Fill in
   `.github/pull_request_template.md`; the "how to verify in the preview"
   section is the part reviewers actually use.
4. **Wait for the preview comment.** The `PR preview` workflow builds the
   single-file standalone and posts/updates a comment with a link:

   ```
   https://raw.githack.com/i-r0n/omni-standalone/main/previews/pr-<N>/index.html
   ```

   It refreshes on every push and is deleted when the PR closes. This is the
   review surface — it runs on a phone, which is the point.
5. **Owner reviews and merges.** The assistant does not merge, even if GitHub
   would let them.
6. **`main` publishes automatically.** `publish-standalone.yml` mirrors every
   push to `main` to `i-r0n/omni-standalone` at
   <https://raw.githack.com/i-r0n/omni-standalone/main/index.html>.

### Privacy note on previews

`I-R0N/Omni` is private, but `i-r0n/omni-standalone` is **public** — githack
can only serve public repos. Every PR preview therefore publishes a fully
playable build of the game to a public URL, and `main` publishes there too.
This is already how the repo works; it is called out because a new contributor
should know that opening a PR is a public act, even though the source is not.

---

## 6. What needs owner sign-off

Merging is always the owner's call. Beyond that, flag these in the PR
description rather than deciding solo:

- Changes to `CLAUDE.md` — it is the shared source of truth for both agents.
  `CLAUDE.md` §10 lists the triggers that *require* an update; hitting one is
  expected, rewriting the spec's opinions is not.
- Anything touching `.github/workflows/` (secrets, publish targets, previews).
- New top-level directories, subsystems, or dependencies.
- Balance and game-feel changes that are not obviously a bug fix — these are
  taste calls, and taste belongs to the owner.
- Adding tooling: test runners, linters, formatters, CI gates. `CLAUDE.md` is
  explicit that none exist and that they should not be invented unopposed.

Safe to do without asking: bug fixes with a clear repro, perf work that does
not change behaviour, doc corrections, and anything the owner already asked
for in writing.

---

## 7. Type checking — a known gap

`CLAUDE.md` §7 says type errors surface during `vite build`. **They do not.**
`vite build` uses esbuild, which strips TypeScript types without checking them.
A green build says nothing about type correctness.

Running the check today:

```
npx tsc --noEmit
```

reports pre-existing errors on `main` (in `constants.ts` and
`engine/systems/ShardSystem.ts`, around the `ShardMergePolicy` shape). That is
why `ci.yml` does **not** gate on it — turning it on now would block every PR,
including unrelated ones.

If you want the gate: fix those errors first in a dedicated PR, add a
`"typecheck": "tsc --noEmit"` script, then add a step to `ci.yml` and make it a
second required status check. Worth doing before the codebase has two agents
generating TypeScript into it, but it is its own piece of work.

---

## 8. Conventions worth repeating

These are the ones that bite newcomers hardest. All are covered in depth in
`CLAUDE.md` §8 — this is the short list to read before the first PR.

- **The world is a torus.** Every distance check, nearest-neighbour scan, and
  targeting calculation must go through `wrapDeltaX` / `wrapDeltaY`. Naive
  `a.x - b.x` compiles, runs, and silently breaks across the map seam.
- **Mutate, don't allocate.** Allocating `{x, y}` inside a physics/render/AI
  per-frame loop is the single most common perf regression here.
- **Periodic work goes through `PerfController`.** Register a task in
  `PERF_TASKS` and gate on `perfController.shouldRun(id)`. Do not roll a
  private frame counter.
- **Static vs dynamic is decided by `mass`**, not by `EntityType`. `Infinity`
  means the static grid.
- **`docs/POLISH_ARCHITECTURE.md` and `docs/PARKING_LOT.md` are stale by
  design.** They are planning history, not specification. `CLAUDE.md` and the
  source are the truth.
