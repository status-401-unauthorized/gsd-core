---
name: update-gsd-local
description: >
  Sync this fork’s grok-build branch from upstream open-gsd (origin/next), resolve
  and analyze merge conflicts for Grok-first-class runtime deltas, rebuild the
  TypeScript lib + capability registry, reinstall GSD into ~/.grok, verify the
  install, then self-review this skill and surface any vital updates to the user.
  Use when the user runs /update-gsd-local, says “update gsd-core”, “sync upstream
  into grok fork”, “refresh local gsd install”, “merge origin/next into grok-build”,
  or wants to pull open-gsd/gsd-core and reinstall for Grok Build.
metadata:
  short-description: "Sync origin/next → grok-build, reinstall ~/.grok"
---

# /update-gsd-local — Sync upstream, preserve Grok deltas, reinstall

End-to-end workflow to pull `origin/next` into this fork’s `grok-build` branch,
keep or adapt fork-only **Grok Build** changes after conflict analysis, rebuild
compiled libs and generated registries, reinstall into `~/.grok`, confirm the
installed version and skill/agent surfaces match the tree, then **self-review
this skill** so it stays aligned with upstream and fork reality (Step 9).

## Preconditions (abort early if unmet)

Run from the **gsd-core** repo root (the tree that contains `bin/install.js`,
`capabilities/grok/`, and `package.json` name `@opengsd/gsd-core`).

1. Confirm remotes (names may vary — detect, do not hard-fail on labels alone):
   - **Upstream** (open-gsd): typically `origin` → `open-gsd/gsd-core`
   - **Fork** (user’s remote): typically `fork` → `status-401-unauthorized/gsd-core`
2. Working tree should be clean enough to merge. If dirty:
   - Prefer stashing only if the user did not intentionally leave WIP.
   - If WIP looks intentional, **stop and ask** before discarding or stashing.
3. Preferred branch: local `grok-build` tracking `fork/grok-build`. If on another
   branch, tell the user and ask whether to switch to `grok-build` or update the
   current branch instead.
4. Node/npm must satisfy `package.json` engines. Prefer **nvm** + repo-root
   **`.nvmrc`** (read the file — currently major **24**; do not assume 22).
   `npm install` must be viable if `node_modules` is missing or stale. System
   Node below engines will fail — activate nvm before Step 6. If `nvm use`
   says the pin is missing, `nvm install` then `nvm use` again.

Record before any mutation:

```bash
git remote -v
git status -sb
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
git rev-parse --short origin/next 2>/dev/null || true
git rev-parse --short fork/grok-build 2>/dev/null || true
```

## Remote / branch model

| Role | Typical remote | Branch |
|------|----------------|--------|
| Upstream source of truth (dev line) | `origin` | `next` |
| Local integration branch (this fork) | (local) | `grok-build` |
| Publish target for this fork | `fork` | `grok-build` |

Notes:

- Upstream’s day-to-day integration branch is **`next`**, not `main`. `main` is
  often older/release-oriented; default merge source is **`origin/next`**.
- If the user explicitly asks to merge `origin/main` (or a release tag), do that
  instead and state the substitution in the completion report.
- Merge **upstream into local `grok-build`**, then (only if user asks or skill is
  run with push intent) update `fork/grok-build`. Default of this skill: **local
  merge + build + reinstall**; do **not** `git push` without explicit approval.

## Known fork themes (Grok-first-class runtime)

These are the intentional deltas this skill must protect or re-evaluate. Update
this list when analysis shows upstream absorbed them or when new fork commits land.

| Theme | Primary paths | Intent |
|-------|---------------|--------|
| Grok as installable runtime | `capabilities/grok/capability.json`, `bin/install.js` (`--grok` / `--grok-build`), runtime lists | First-class Grok Build install target → `~/.grok` |
| Capability registry + homes | `gsd-core/bin/lib/capability-registry.cjs` (**generated**), `src/runtime-homes.cts`, `src/runtime-name-policy.cts`, aliases/catalog JSON | Descriptor-driven config home `.grok` / `GROK_HOME`. Grok **is** a registry runtime — do **not** re-list it in `LEGACY_NON_REGISTRY_RUNTIME_IDS`. Adapt origin/next tests that still treat grok as a `#3024` `~/.agents` legacy id. |
| Host-integration parity | `capabilities/grok/capability.json` → `runtime.hostIntegration` | Track upstream descriptor schema (`dispatch.*`, `effortSurface`, …) so negotiation does not fail closed; see Step 4 |
| Claude → Grok converters | `src/runtime-artifact-conversion.cts` → `gsd-core/bin/lib/runtime-artifact-conversion.cjs` | `convertClaudeCommandToGrokSkill`, `convertClaudeAgentToGrokAgent`, tool-name rewrites (`Task`→`spawn_subagent`, etc.) |
| Native Grok hooks | `src/runtime-hooks-surface.cts`, install plan `hooksSurface: grok-hooks-json` | Managed `~/.grok/hooks/gsd-lifecycle.json` + shared hook scripts |
| Model tiers | `gsd-core/bin/shared/model-catalog.json` | Grok Build / Composer model ids for GSD model profiles |
| Docs + tests | `docs/how-to/install-on-your-runtime.md`, `tests/grok-upgrades.test.cjs`, multi-runtime select tests | Document install path; regression cover for Grok surfaces |

**Descriptor schema drift is an adapt trigger:** when upstream adds or renames
fields on runtime `capability.json` / `hostIntegration` (e.g. `dispatch.isolation`
from ADR-1239 / #2584), port the equivalent into `capabilities/grok/capability.json`
and regenerate the registry — do not leave Grok omitted while peers declare the axis.

**#3024 / #3547 adapt triggers (homes + install harness):**

- Upstream still documents grok as a non-registry `~/.agents` id
  (`LEGACY_NON_REGISTRY_RUNTIME_IDS`, skills-root tests, `sync-skills.md`
  prose, `scripts/live-config-guard.cjs`). This fork’s grok is first-class
  `~/.grok` / `GROK_HOME`. After merge, re-point those tests/docs; keep the
  hardcoded `getGlobalConfigDir('grok')` fallback only for a missing registry.
- `#3547` (`runMinimalInstall`) refuses to guess a global home without
  `RUNTIME_META[runtime].globalSuffix` in `tests/helpers/install-shared.cjs`.
  Declare `grok: { localDir: '.grok', globalSuffix: '.grok' }` or
  `tests/grok-upgrades.test.cjs` install cases fail. Keep grok **out** of
  `MANIFEST_FAMILIES` (no `tests/fixtures/install-tree/grok.json` golden).

**#2875 / VALID_CONVERTER_NAMES adapt triggers (agents path + closed enum):**

- `#2875` deleted `bin/install.js`'s `_DESCRIPTOR_AGENTS_RUNTIMES` allow-list
  and the inline agents loop. **Do not restore that set** (including a grok
  member) — `tests/declarative-reference-augment.test.cjs` fails on a live
  `const _DESCRIPTOR_AGENTS_RUNTIMES =`. Grok is a skills runtime with a
  non-empty `artifactLayout` (`convertClaudeCommandToGrokSkill` /
  `convertClaudeAgentToGrokAgent`), so agents stay on the descriptor path
  via `installRuntimeArtifacts`. Prefer origin/next's agents-materialization
  comment over the pre-#2875 fork exclusion list.
- `tests/capability-registry.test.cjs` asserts `VALID_CONVERTER_NAMES.size`
  and a complete expected-name list. Upstream bumps the count when it adds
  converters; this fork must keep `convertClaudeCommandToGrokSkill` and
  `convertClaudeAgentToGrokAgent`. As of the v1.11.0 / #2875 merge the
  closed set is **32** (17 command/skill/workflow + 15 agent). Re-count from
  `gsd-core/bin/lib/capability-validator.cjs` after merge — do not keep the
  stale 29 (ours) or 30 (theirs) literals.

Non-merge feature commits on the fork (historically):

```text
feat: add Grok Build as a first-class installable runtime
feat(grok): native hooks, Grok 4.5 model tiers, and expanded adapters
fix(grok): rewrite Claude tool names to Grok natives on install
fix(grok): declare dispatch.isolation harness-worktree after origin/next
fix(grok): declare effortSurface undocumented after origin/next
chore: regenerate bin/lib after origin/next merge
chore(grok): track /update-gsd-local skill in-repo
chore(grok): require nvm use before build in update-gsd-local
chore(grok): document tsc incremental cache wipe in update-gsd-local
fix(grok): declare RUNTIME_META.globalSuffix after #3547
chore(grok): refresh update-gsd-local after origin/next (Node 24, #3547)
chore(grok): document #2875 agents path + VALID_CONVERTER_NAMES in update-gsd-local
```

Plus periodic `Merge origin/next into grok-build` commits.

## Generated artifacts (do not confuse these)

| Artifact | Produced by | Not produced by |
|----------|-------------|-----------------|
| Most `gsd-core/bin/lib/*.cjs` from `src/*.cts` | `npm run build:lib` (`tsc -p tsconfig.build.json`) | hand-edit forever |
| **`capability-registry.cjs`** | **`npm run gen:capability-registry`** (`scripts/gen-capability-registry.cjs --write` from `capabilities/*/capability.json`) | **`build:lib` / tsc** |
| Loop host contract, plugin skills, package identity | `gen:loop-host-contract`, `gen:plugin-skills`, `generate:identity` | `build:lib` alone |
| Section manifest, CONTEXT-INDEX | `gen:section-manifest`, `gen:context-index` | `build:lib` alone |
| Hook scripts under pack | `npm run build:hooks` | `build:lib` alone |
| Full release-shaped pipeline | `npm run build` (= identity + lib + **section-manifest** + **context-index** + plugin-skills + loop-host-contract + **capability-registry** + hooks) | partial steps only |

Editing `capabilities/grok/**` **without** `gen:capability-registry` leaves a
stale registry (install and negotiation read the generated file). Prefer
regenerating sources correctly, then generators — never long-lived hand merges of
generated output.

## Steps

### 1. Fetch upstream

```bash
git fetch origin next
# Optional but useful for comparison:
git fetch fork grok-build
```

Show how far behind:

```bash
git log --oneline --left-right --cherry-pick HEAD...origin/next | head -40
git rev-list --left-right --count HEAD...origin/next
```

If already up to date with `origin/next` (0 commits on the upstream side to merge),
skip merge/conflict steps and jump to **Step 6 (build)** unless the user only
wanted a reinstall of the current tree (then jump to Step 7).

### 2. Merge origin/next into local grok-build

Ensure on the integration branch (default `grok-build`):

```bash
git checkout grok-build
git merge origin/next
```

Commit message style used in this repo when wrapping merges:

```text
Merge origin/next into grok-build; keep Grok as first-class runtime
```

Variants that match history:

```text
Merge remote-tracking branch 'origin/next' into grok-build
Merge origin/next into grok-build; <brief note of preserved Grok deltas>
```

If the merge completes cleanly, note “no conflicts” and continue to Step 4 with a
light fork-delta review (Step 4 still runs — use the pre-merge fork tip vs
merge-base to list unique fork commits).

### 3. Resolve conflicts

If merge stops with conflicts:

```bash
git status
git diff --name-only --diff-filter=U
```

For each conflicted file:

1. Read both sides (`git show :2:path`, `git show :3:path`, and the working tree
   conflict markers). Stage 2 = ours (`grok-build`), stage 3 = theirs
   (`origin/next`).
2. Prefer **preserving intentional Grok fork behavior** unless upstream clearly
   supersedes it (see Step 4 criteria). Especially careful on:
   - `bin/install.js` (runtime flags, help text; after `#2875` do **not**
     re-add `_DESCRIPTOR_AGENTS_RUNTIMES`)
   - `src/runtime-*.cts` and generated `gsd-core/bin/lib/*.cjs`
   - `capabilities/grok/**` (ours; may be untracked on upstream)
   - capability registry generators / `capability-registry.cjs`
   - tests that list runtimes or assume grok is a `~/.agents` legacy id
   - `tests/helpers/install-shared.cjs` (`RUNTIME_META` / `MANIFEST_FAMILIES`)
   - `tests/capability-registry.test.cjs` (`VALID_CONVERTER_NAMES` size +
     expected names must include both Grok converters)
3. For generated CJS under `gsd-core/bin/lib/`:
   - Prefer resolving **source** correctly, then regenerate — **not** hand-editing
     both forever.
   - From `src/*.cts` → `npm run build:lib`.
   - From `capabilities/*/capability.json` (including Grok) →
     **`npm run gen:capability-registry`** (not `build:lib`).
   - If both sides only touch generated output, rebuild/regenerate after resolving
     sources/descriptors.
4. Resolve markers completely — no leftover `<<<<<<<`, `=======`, `>>>>>>>`.
5. `git add` each resolved path.

Do **not** `git merge --abort` unless the user asks or resolution is impossible
without guidance. If stuck after serious analysis, present options and ask.

### 4. Analyze conflicts / fork-only changes

This step is mandatory even when Git auto-merged: Grok fork intent must still hold.

**Identify fork-only work** (commits on local/fork not in upstream):

```bash
# Commits on HEAD that are not on origin/next (before merge: use pre-merge tip)
git log --oneline origin/next..HEAD   # or: merge-base..fork-tip if mid-merge
git log --oneline --no-merges origin/next..HEAD
```

Also:

```bash
# Files still differing after merge (sanity)
git diff --stat origin/next...HEAD | head -50
# Search upstream tree for accidental absorption of Grok support
git grep -n -- 'grok' origin/next -- 'capabilities' 'bin/install.js' 'src' 'docs' 2>/dev/null | head -40
```

For **each** conflicted path or non-trivial fork delta, write a short analysis
(to the user, not necessarily a file):

| Question | How to decide |
|----------|----------------|
| **(a) Still needed?** | Is the Grok change still a product goal? Did upstream land an equivalent runtime, converter, or hooks surface? Search upstream for `grok`, `GROK_HOME`, `convertClaude*Grok`, `grok-hooks-json`. |
| **(b) Still works as before?** | After resolution, do install flags, capability descriptor, converters, and tests still match? Re-read install paths and `tests/grok-upgrades.test.cjs`. |
| **(c) Descriptor / hostIntegration parity?** | Did upstream add axes on peer runtimes’ `capability.json`? Diff Grok’s `runtime.hostIntegration` against `claude` / `cursor` / `codex`. See checklist below. |

Outcomes per delta:

- **Keep as-is** — re-apply or retain fork side; cite why.
- **Adapt** — upstream moved (e.g. new runtime registry shape, install refactor,
  hostIntegration axes); port Grok intent onto the new structure (Step 5).
- **Drop** — upstream fully supersedes (official Grok runtime landed); document why and prefer upstream’s implementation.

High-priority intent (unless analysis shows upstream absorbed it): **Grok Build is a first-class installable runtime** with native skill/agent conversion, tool rewrites, and lifecycle hooks under `~/.grok`.

#### hostIntegration / dispatch parity checklist (run every merge)

Upstream evolves `runtime.hostIntegration` on first-party descriptors. Grok’s
descriptor is fork-only and will **not** receive those edits unless this skill
ports them.

1. Compare dispatch (and related) fields:

```bash
node -e '
for (const id of ["grok","claude","cursor","codex"]) {
  const c=require("./capabilities/"+id+"/capability.json");
  console.log(id, JSON.stringify(c.runtime?.hostIntegration?.dispatch || null, null, 0));
}
'
```

2. If peers gained new axes that Grok omits (`isolation`, `effortSurface`, …),
   **adapt** — do not leave omitted when Grok can declare a true value.
   Omitted optional fields often **fail closed** in negotiation (safe floor),
   which silently disables features (e.g. worktree isolation for execute-phase).
3. Known mapping for Grok Build (as of harness-worktree support):
   - Grok `spawn_subagent(..., isolation="worktree")` is a **host** isolation
     primitive → declare `"isolation": "harness-worktree"` on
     `runtime.hostIntegration.dispatch` (same class as Claude/Cursor; **not**
     `orchestrator-worktree`, which means GSD creates worktrees itself).
   - If Grok later drops native worktree isolation, set `"none"` or omit only
     with an explicit analysis note.
4. After any edit to `capabilities/grok/capability.json`:
   `npm run gen:capability-registry` (Step 6). Confirm the embedded grok
   dispatch in `gsd-core/bin/lib/capability-registry.cjs` matches the descriptor.

### 5. Implement post-analysis adjustments

If Step 4 requires code changes beyond pure conflict resolution:

1. Implement the adapted keep/drop decisions (including hostIntegration parity).
2. Prefer small, reviewable edits in the same merge resolution window.
3. Prefer editing sources/descriptors and regenerating over divergent hand-edits
   of generated CJS:
   - `src/*.cts` → `npm run build:lib`
   - `capabilities/**/capability.json` → `npm run gen:capability-registry`
4. Run focused tests for Grok surfaces (do not block forever on full suite):

```bash
# After build:lib (+ gen:capability-registry if descriptors changed)
node --test tests/grok-upgrades.test.cjs
# Optional broader runtime install coverage when install paths changed:
# node scripts/run-tests.cjs --suite install   # can be slow
```

5. Stage and include in the merge commit if still in progress, or make a
   follow-up commit on `grok-build` with a clear message (e.g.
   `fix(grok): re-adapt converters after origin/next merge` or
   `fix(grok): declare dispatch.isolation harness-worktree after origin/next`
   or `fix(grok): declare RUNTIME_META.globalSuffix after #3547`).

### 6. Build the TypeScript / generated libs

**Always activate the Node version from `.nvmrc` before any `npm` / build
command.** Agent non-interactive shells often lack nvm as a function — load it
first, then `nvm use` from the repo root:

```bash
# Load nvm if needed (nvm is a shell function, not a binary on PATH)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Fail early if nvm or the pin is unavailable
command -v nvm >/dev/null || { echo "nvm not available; install nvm or fix NVM_DIR"; exit 1; }
nvm use          # reads repo-root .nvmrc (currently 24 → latest matching Node)
# If the version is missing: nvm install   # then nvm use again
node -v && npm -v   # expect versions that satisfy package.json engines (Node ≥24, npm ≥10 as of 1.10.0)
```

Default post-merge build (covers tsc, Grok descriptor registry, hooks):

```bash
# After nvm use (required):
# If deps missing or package-lock changed substantially:
npm install

npm run build:lib
npm run gen:capability-registry
npm run build:hooks
```

When unsure what drifted (capability registry, loop-host contract, plugin skills,
section-manifest, CONTEXT-INDEX, hooks), prefer the full pipeline:

```bash
# After nvm use (required):
npm run build
```

Use a generous timeout on cold `npm install` / full `build` (several minutes is
normal).

**Incremental `tsc` after large merges:** `build:lib` uses
`tsconfig.build.tsbuildinfo`. Many ADR-457 artifacts under `gsd-core/bin/lib/*.cjs`
are **gitignored** and only emitted from `src/*.cts`. After a big `origin/next`
merge, the incremental cache can report success while **never emitting** modules
that were not present in the local `outDir` yet. Symptom: install or tests fail
with `Cannot find module './some-module.cjs'` (e.g. `runtime-artifact-install-plan.cjs`)
even though `src/some-module.cts` exists. Fix:

```bash
rm -f tsconfig.build.tsbuildinfo
npm run build:lib
```

Prefer that clean rebuild when Step 6 or 7 hits `MODULE_NOT_FOUND` for a
gitignored lib with a matching `src/*.cts` source.

**Always** run `gen:capability-registry` when:

- `capabilities/grok/**` (or any capability descriptor) was edited in Step 5, or
- upstream changed `scripts/gen-capability-registry.cjs`,
  `gsd-core/bin/lib/capability-validator.cjs`, or peer `capabilities/*/capability.json`
  hostIntegration shapes that you ported to Grok.

If the build fails:

1. Fix compile/type/generator errors caused by the merge/adaptation.
2. Rebuild until success.
3. Do not claim success without exit 0 from:
   - `npm run build:lib` (or equivalent `tsc -p tsconfig.build.json`), **and**
   - `npm run gen:capability-registry` when descriptors or registry inputs changed
     (default happy path always runs it).

### 7. Reinstall GSD into ~/.grok

Install from **this working tree** (not npm registry), global Grok runtime:

```bash
node bin/install.js --grok --global
```

Equivalent documented form for published packages is
`npx @opengsd/gsd-core@latest --grok --global`; for fork development always use
the local `node bin/install.js` so fork converters apply.

Optional env overrides:

```bash
# Only if user asked for a non-default home
GROK_HOME=~/.grok-alt node bin/install.js --grok --global --config-dir ~/.grok-alt
```

Default target: `~/.grok` (or `$GROK_HOME`).

Expect surfaces:

| Surface | Path |
|---------|------|
| Core pack | `~/.grok/gsd-core/` (`VERSION`, workflows, bin, …) |
| Skills | `~/.grok/skills/gsd-*/SKILL.md` |
| Agents | `~/.grok/agents/gsd-*.md` |
| Hooks | `~/.grok/hooks/` + `gsd-lifecycle.json` |
| Runtime marker | `~/.grok/gsd-core/.gsd-runtime` → `grok` |

If install fails, fix errors (often missing build artifacts — re-run Step 6) and
retry. For `MODULE_NOT_FOUND` on a gitignored `gsd-core/bin/lib/*.cjs` that has a
matching `src/*.cts`, wipe the incremental cache first
(`rm -f tsconfig.build.tsbuildinfo && npm run build:lib`) then reinstall. Do not
claim success without a clean installer exit.

### 8. Verify install

Source of truth for package semver:

```text
package.json  →  "version": "X.Y.Z"
```

Installed marker:

```text
~/.grok/gsd-core/VERSION
```

Verification:

```bash
EXPECTED=$(node -p "require('./package.json').version")
INSTALLED=$(cat "$HOME/.grok/gsd-core/VERSION" 2>/dev/null || true)
SHORT=$(git rev-parse --short HEAD)
echo "Expected package version: $EXPECTED  HEAD: $SHORT"
echo "Installed VERSION file:   $INSTALLED"

# Runtime marker
cat "$HOME/.grok/gsd-core/.gsd-runtime"

# Surface counts (numbers may grow with upstream skill set)
echo -n "gsd skills: "; ls "$HOME/.grok/skills" 2>/dev/null | grep -c '^gsd-' || true
echo -n "gsd agents: "; ls "$HOME/.grok/agents" 2>/dev/null | grep -c '^gsd-' || true
test -f "$HOME/.grok/hooks/gsd-lifecycle.json" && echo "hooks: gsd-lifecycle.json present" || echo "hooks: MISSING"

# Spot-check converter output: a skill should look Grok-native (spawn_subagent / ask_user_question)
# not pure Claude Task()/AskUserQuestion-only, when adapters ran.
rg -l 'spawn_subagent|ask_user_question|grok_skill_adapter' "$HOME/.grok/skills" 2>/dev/null | head -5

# When Step 4 adapted hostIntegration (or every merge as a cheap sanity check):
# installed registry must reflect descriptor isolation (not stale pre-gen file).
node -e '
const r=require(process.env.HOME+"/.grok/gsd-core/bin/lib/capability-registry.cjs");
const d=r.capabilities.grok.runtime.hostIntegration.dispatch;
console.log("installed grok dispatch:", JSON.stringify(d));
if (d.isolation !== "harness-worktree") {
  console.error("WARN: expected dispatch.isolation harness-worktree; got", d.isolation);
  process.exitCode = 1;
}
'
```

**Pass criteria:**

- `~/.grok/gsd-core/VERSION` equals `package.json` version.
- `.gsd-runtime` is `grok`.
- At least one `gsd-*` skill and agent installed; lifecycle hooks file present
  when fork hooks support is kept.
- Converters: installed skills show Grok-native tools / adapter blocks.
- When isolation is kept as harness-worktree: installed registry
  `capabilities.grok.runtime.hostIntegration.dispatch.isolation` is
  `harness-worktree` (catches skipped `gen:capability-registry`).
- Optional: `node --test tests/grok-upgrades.test.cjs` still green post-merge.

**Fail if:**

- VERSION is stale vs package.json (install did not run or targeted wrong home).
- Runtime marker is not `grok`.
- Skills/agents missing after a claimed successful install.
- Fork analysis said “keep converters” but installed skills still reference only
  Claude tool names with no Grok adapter/rewrite (install path bypassed conversion).
- Step 4 adapted isolation (or declared harness-worktree) but installed registry
  still omits it or shows `none` / wrong value (stale registry not regenerated
  before install).

On fail: confirm `GROK_HOME` / `--config-dir`, re-run Step 6 (including
`gen:capability-registry`) then install from repo root, re-check paths.

### 9. Self-review this skill (mandatory every run)

After install verification (or after an early exit that still completed meaningful
work — e.g. already-up-to-date reinstall), **re-read this skill** and compare it
to what actually happened in this run. Goal: keep `/update-gsd-local` from
drifting away from upstream and from this fork’s real Grok deltas.

**Do not skip.** Even when the merge was clean and no code adapt was needed, still
run the review and report the result (often “no skill changes needed”).

Skill path (prefer repo-local, fall back to installed):

```text
.grok/skills/update-gsd-local/SKILL.md
# or, if only the installed copy exists:
~/.grok/skills/update-gsd-local/SKILL.md
```

#### What to re-read against this run

Hold the skill text next to facts from Steps 1–8:

| Skill area | Ask |
|------------|-----|
| Known fork themes | Did upstream absorb Grok? New fork-only paths? Theme table stale? |
| Generated artifacts / build | Did this run need a command or generator the skill omits or mislabels? |
| Conflict / adapt criteria | New hot files, hostIntegration axes, install flags, test names? |
| hostIntegration checklist | Isolation mapping still true? New required axes on peers? |
| Verify pass/fail | New install surfaces, count expectations, registry checks wrong? |
| Historical commits | New non-merge fork commits worth listing? |
| Safety / quick reference | Commands in happy path still match what worked? |
| Remotes / branch model | Upstream default branch still `next`? Fork remote labels still valid? |

Also scan for **procedure gaps** discovered mid-run (wrong default command, missing
timeouts, stale package version assumptions, skill living only under untracked
`.grok/` vs installed `~/.grok/skills/`, etc.).

#### Classification of findings

For each potential skill edit, classify:

| Class | Meaning | Default action |
|-------|---------|----------------|
| **Vital** | Next run would fail, skip a required regen, drop a Grok delta, or silently degrade (e.g. omit isolation) | Propose concrete SKILL.md edit; **do not apply unless user approves** |
| **Useful** | Would reduce friction or clarify; not required for correctness | Propose briefly; apply only if user asks |
| **Cosmetic** | Wording, ordering, history nits | Mention only if cheap; otherwise omit |
| **None** | Skill matched this run | State explicitly: “Skill self-review: no changes suggested” |

#### Output to the user (always)

Print a dedicated section **after** the completion report (or as its last numbered
item), titled e.g. **Skill self-review**:

```markdown
### Skill self-review

**Verdict:** no changes needed | N vital / M useful suggestion(s)

| Priority | Area | Observation from this run | Suggested skill change |
|----------|------|---------------------------|------------------------|
| Vital | … | … | … |
```

Rules:

1. **Show suggestions to the user** — never silently edit this skill.
2. **Do not apply** Vital/Useful edits until the user confirms (or asks to apply).
3. If the user already asked to apply skill updates in the same turn, apply only
   what they approved; keep the table in the report for the record.
4. Prefer **small, surgical** suggestions (patch-level) over rewriting the skill.
5. If a Vital gap is found, say so clearly; do not bury it under “optional next steps.”
6. When the only outcome is “none,” still print one line so the step is auditable.

#### When to update known themes / history from this step

If Step 4 dropped a theme (upstream absorbed Grok) or Step 5 landed a new
intentional fork commit, include a **Vital** or **Useful** row to update:

- the Known fork themes table, and/or
- the historical non-merge commit list,

so the next agent does not re-litigate settled decisions.

## Completion report (always print)

Summarize for the user:

1. **Sync:** pre/post SHAs (`HEAD`, `origin/next`), commits merged count
   (`git rev-list --count <pre>..HEAD` after merge).
2. **Conflicts:** files (or “none”), resolution summary.
3. **Fork analysis:** each Grok delta → keep / adapt / drop + one-line rationale;
   call out hostIntegration / isolation decision explicitly.
4. **Code adjustments:** what was implemented after analysis (or “none”).
5. **Build:** success/fail, note `nvm use` / Node+npm versions, then commands
   (`build:lib` / `gen:capability-registry` / `build:hooks` / full `build`).
6. **Install:** success/fail, command `node bin/install.js --grok --global`, target
   home, VERSION match.
7. **Verify:** VERSION, runtime marker, skill/agent counts, hooks presence,
   converter spot-check, installed registry `dispatch.isolation` when applicable.
8. **Skill self-review (Step 9):** verdict + table of Vital/Useful suggestions (or
   “no changes needed”). Do not mark the run complete without this section.
9. **Next steps (optional):** push to `fork/grok-build` only if user wants:
   `git push fork grok-build` (require confirmation — shared remote).
   Restart Grok Build / new session so skills reload; `grok inspect` if available.
   Apply approved skill edits if any from Step 9.

## Safety rules

- Never force-push to `origin` or `fork` unless the user explicitly requests it.
- Never `git reset --hard` or discard uncommitted work without confirmation.
- Prefer resolving conflicts over aborting; abort only on user request or
  unrecoverable state.
- Do not skip Step 4 (analysis) when there were conflicts or unique fork commits.
- Do not skip hostIntegration parity when peer descriptors gained new axes.
- Do not skip Step 9 (skill self-review); always show the verdict to the user.
- Do not silently edit this skill; propose first, apply only with user approval.
- Do not claim install success without reading `~/.grok/gsd-core/VERSION` (or the
  configured `GROK_HOME`) after the installer runs.
- Do not install from npm registry when the goal is to deploy **this fork’s** Grok
  support — always `node bin/install.js` from the repo.
- Prefer regenerating artifacts correctly:
  - `src/*.cts` → `npm run build:lib`
  - `capabilities/**` → `npm run gen:capability-registry`
  - never long-lived hand merges of generated files
- Do not treat `build:lib` as sufficient for descriptor/registry changes.
- Do not run `npm install` / `build:lib` / `gen:capability-registry` / tests /
  install without **`nvm use`** (after loading `$NVM_DIR/nvm.sh` if needed) so
  Node/npm match `.nvmrc` and `package.json` engines.

## Quick reference

```bash
# Full happy path (agent expands conflict/analysis as needed)
git fetch origin next
git checkout grok-build
git merge origin/next   # resolve + analyze Grok deltas + hostIntegration parity
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}" && . "$NVM_DIR/nvm.sh" && nvm use
npm install             # if lockfile / deps changed
# If MODULE_NOT_FOUND on gitignored bin/lib after merge:
#   rm -f tsconfig.build.tsbuildinfo && npm run build:lib
npm run build:lib
npm run gen:capability-registry   # required; not covered by build:lib
npm run build:hooks
# or: npm run build
node --test tests/grok-upgrades.test.cjs   # focused regression
node bin/install.js --grok --global
cat ~/.grok/gsd-core/VERSION
cat ~/.grok/gsd-core/.gsd-runtime
node -e 'const r=require(process.env.HOME+"/.grok/gsd-core/bin/lib/capability-registry.cjs"); console.log(r.capabilities.grok.runtime.hostIntegration.dispatch);'
# Step 9: re-read .grok/skills/update-gsd-local/SKILL.md vs this run;
# print Skill self-review (vital/useful/none) — do not silent-edit the skill
```
