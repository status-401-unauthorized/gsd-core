---
type: Fixed
pr: 0
---
**Subagent prompts embedding orchestrator-relative planning paths now resolve correctly when the spawned subagent's own working directory differs from the orchestrator's (e.g. a git worktree)** — `init.*` command handlers and the workflows that spawn planner/checker/verifier/synthesizer/roadmapper/debugger subagents previously emitted `state_path`, `roadmap_path`, `phase_dir`, and similar fields relative to the orchestrator's own cwd, or hardcoded bare `.planning/...` literals directly into subagent prompts; a subagent spawned into a different cwd would then report real, already-committed files as missing. These paths are now absolute, anchored on the project root. (#2376)
