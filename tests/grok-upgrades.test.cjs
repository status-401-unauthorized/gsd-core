'use strict';

/**
 * Grok Build upgrades — native hooks, adapter, model tiers (Grok 4.5 / CLI 0.2.9x).
 *
 *   1. hooksSurface: none → grok-hooks-json; managed ~/.grok/hooks/gsd-lifecycle.json
 *   2. skill/agent adapter: background, isolation, Plan Mode, CLAUDE.md → AGENTS.md
 *   3. model catalog: grok-build + grok-composer-2.5-fast
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runMinimalInstall } = require('./helpers/install-shared.cjs');
const { cleanup, createTempDir } = require('./helpers.cjs');
const {
  writeGrokHooksJson,
  removeGrokHooksJson,
  GSD_GROK_HOOKS_FILE,
  GSD_GROK_HOOK_MARKER,
} = require('../gsd-core/bin/lib/runtime-hooks-surface.cjs');
const {
  convertClaudeCommandToGrokSkill,
  convertClaudeAgentToGrokAgent,
  convertClaudeToGrokMarkdown,
  rewriteClaudeToolsToGrok,
  mapClaudeToolsListToGrok,
} = require('../gsd-core/bin/lib/runtime-artifact-conversion.cjs');
const { catalog } = require('../gsd-core/bin/lib/model-catalog.cjs');

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

describe('grok model catalog tiers', () => {
  test('runtimeTierDefaults.grok uses grok-build + grok-composer-2.5-fast', () => {
    const tiers = catalog.runtimeTierDefaults.grok;
    assert.ok(tiers, 'grok tiers must exist');
    assert.equal(tiers.opus.model, 'grok-build');
    assert.equal(tiers.opus.reasoning_effort, 'xhigh');
    assert.equal(tiers.sonnet.model, 'grok-build');
    assert.equal(tiers.sonnet.reasoning_effort, 'high');
    assert.equal(tiers.haiku.model, 'grok-composer-2.5-fast');
    assert.equal(tiers.haiku.reasoning_effort, 'medium');
  });
});

// ---------------------------------------------------------------------------
// Unit: writeGrokHooksJson / removeGrokHooksJson
// ---------------------------------------------------------------------------

describe('writeGrokHooksJson / removeGrokHooksJson', () => {
  function seedHookScripts(targetDir) {
    const hooksDir = path.join(targetDir, 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    for (const name of [
      'gsd-check-update.js',
      'gsd-prompt-guard.js',
      'gsd-context-monitor.js',
      'gsd-workflow-guard.js',
    ]) {
      fs.writeFileSync(path.join(hooksDir, name), `// stub ${name}\n`, 'utf8');
    }
  }

  test('writes managed gsd-lifecycle.json with Claude-dialect events', (t) => {
    const dir = createTempDir();
    t.after(() => cleanup(dir));
    seedHookScripts(dir);

    const result = writeGrokHooksJson(dir, { runtime: 'grok' });
    assert.equal(result.entryCount, 4);
    assert.equal(result.changed, true);
    assert.ok(fs.existsSync(result.hooksJsonPath));
    assert.equal(path.basename(result.hooksJsonPath), GSD_GROK_HOOKS_FILE);

    const payload = JSON.parse(fs.readFileSync(result.hooksJsonPath, 'utf8'));
    assert.ok(payload.hooks);
    for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']) {
      assert.ok(Array.isArray(payload.hooks[event]), `hooks.${event} must be an array`);
      const group = payload.hooks[event][0];
      assert.ok(group.hooks?.[0]?.[GSD_GROK_HOOK_MARKER], `${event} entry must carry gsd-managed marker`);
      assert.equal(group.hooks[0].type, 'command');
      assert.ok(typeof group.hooks[0].command === 'string' && group.hooks[0].command.length > 0);
    }
    assert.match(payload.hooks.PostToolUse[0].matcher, /run_terminal_command/);
  });

  test('Grok hook commands avoid the #3662 ${n} chain token (Grok interpolates ${VAR})', (t) => {
    const dir = createTempDir();
    t.after(() => cleanup(dir));
    seedHookScripts(dir);

    writeGrokHooksJson(dir, { runtime: 'grok' });
    const payload = JSON.parse(fs.readFileSync(path.join(dir, 'hooks', GSD_GROK_HOOKS_FILE), 'utf8'));
    for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']) {
      const command = payload.hooks[event][0].hooks[0].command;
      assert.doesNotMatch(
        command,
        /\$\{n/,
        `${event} must not embed \${n} — Grok treats it as a required env var: ${command}`,
      );
      assert.doesNotMatch(
        command,
        /"\$\(for n in /,
        `${event} must not use the #3662 inline chain token: ${command}`,
      );
      assert.match(
        command,
        /gsd-node-runner\.sh/,
        `${event} must route through gsd-node-runner.sh: ${command}`,
      );
    }
  });

  test('portableHooks grok commands still avoid ${n}', (t) => {
    const dir = createTempDir();
    t.after(() => cleanup(dir));
    seedHookScripts(dir);

    writeGrokHooksJson(dir, { runtime: 'grok', portableHooks: true });
    const payload = JSON.parse(fs.readFileSync(path.join(dir, 'hooks', GSD_GROK_HOOKS_FILE), 'utf8'));
    const command = payload.hooks.PreToolUse[0].hooks[0].command;
    assert.doesNotMatch(command, /\$\{n/, `portable grok command must not embed \${n}: ${command}`);
    assert.match(command, /gsd-node-runner\.sh/, `portable grok command must use the resolver: ${command}`);
  });

  test('is idempotent when content unchanged', (t) => {
    const dir = createTempDir();
    t.after(() => cleanup(dir));
    seedHookScripts(dir);

    const first = writeGrokHooksJson(dir, { runtime: 'grok' });
    const second = writeGrokHooksJson(dir, { runtime: 'grok' });
    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(second.entryCount, 4);
  });

  test('preserves sibling user hook JSON files', (t) => {
    const dir = createTempDir();
    t.after(() => cleanup(dir));
    seedHookScripts(dir);
    const userHook = path.join(dir, 'hooks', 'my-custom.json');
    fs.writeFileSync(userHook, '{"hooks":{}}\n', 'utf8');

    writeGrokHooksJson(dir, { runtime: 'grok' });
    assert.ok(fs.existsSync(userHook), 'user hook JSON must remain');
    assert.equal(fs.readFileSync(userHook, 'utf8'), '{"hooks":{}}\n');
  });

  test('removeGrokHooksJson removes only the managed file', (t) => {
    const dir = createTempDir();
    t.after(() => cleanup(dir));
    seedHookScripts(dir);
    const userHook = path.join(dir, 'hooks', 'my-custom.json');
    fs.writeFileSync(userHook, '{"hooks":{}}\n', 'utf8');

    writeGrokHooksJson(dir, { runtime: 'grok' });
    const removed = removeGrokHooksJson(dir);
    assert.equal(removed.changed, true);
    assert.ok(!fs.existsSync(path.join(dir, 'hooks', GSD_GROK_HOOKS_FILE)));
    assert.ok(fs.existsSync(userHook));

    const again = removeGrokHooksJson(dir);
    assert.equal(again.changed, false);
  });
});

// ---------------------------------------------------------------------------
// Adapter conversion
// ---------------------------------------------------------------------------

describe('Grok skill/agent adapters', () => {
  test('convertClaudeCommandToGrokSkill injects 4.5 adapter block', () => {
    const src = `---
name: gsd-plan-phase
description: Plan a phase
---

Use Task(subagent_type="gsd-planner", prompt="...") and AskUserQuestion.
Read CLAUDE.md for project rules.
`;
    const out = convertClaudeCommandToGrokSkill(src, 'gsd-plan-phase');
    assert.match(out, /<grok_skill_adapter>/);
    assert.match(out, /background\?=.*capability_mode\?=.*isolation\?=/);
    assert.match(out, /get_command_or_subagent_output/);
    assert.match(out, /enter_plan_mode/);
    assert.match(out, /exit_plan_mode/);
    assert.match(out, /spawn_subagent\(/);
    assert.match(out, /ask_user_question/);
    // File I/O mapping table must be present in the adapter (not only orchestration).
    assert.match(out, /search_replace/);
    assert.match(out, /read_file/);
    assert.match(out, /run_terminal_command/);
    assert.match(out, /File I\/O and shell/);
    // Body rewrites CLAUDE.md → AGENTS.md; adapter may still mention CLAUDE.md as a source mapping.
    const body = out.split('</grok_skill_adapter>')[1] || '';
    assert.match(body, /AGENTS\.md/);
    assert.doesNotMatch(body, /CLAUDE\.md/);
  });

  test('convertClaudeAgentToGrokAgent adds spawn depth + isolation notes', () => {
    const src = `---
name: gsd-executor
description: Execute plans
tools: Read, Write, Bash
---

Body here. Uses Task(subagent_type="x") — should not nest.
`;
    const out = convertClaudeAgentToGrokAgent(src);
    assert.match(out, /<grok_agent_role>/);
    assert.match(out, /spawn_subagent\(subagent_type="gsd-executor"/);
    assert.match(out, /background\?=false/);
    assert.match(out, /isolation\?=/);
    assert.match(out, /Max spawn depth is 1/);
    assert.match(out, /isolation="worktree"/);
    // tools: frontmatter mapped to Grok names in role header
    assert.match(out, /tools: read_file, search_replace, run_terminal_command/);
    assert.match(out, /search_replace only/);
  });
});

// ---------------------------------------------------------------------------
// Full Claude → Grok tool-name rewrite (Write/Read/Bash/… → Grok natives)
// ---------------------------------------------------------------------------

describe('rewriteClaudeToolsToGrok / convertClaudeToGrokMarkdown', () => {
  test('mapClaudeToolsListToGrok maps Claude allowlists and keeps mcp wildcards', () => {
    assert.equal(
      mapClaudeToolsListToGrok('Read, Write, Edit, Bash, Grep, Glob, Skill, WebSearch, WebFetch'),
      'read_file, search_replace, search_replace, run_terminal_command, grep, list_dir, read_file, web_search, open_page',
    );
    assert.equal(
      mapClaudeToolsListToGrok('Read, mcp__context7__*, Bash'),
      'read_file, mcp__context7__*, run_terminal_command',
    );
    // Idempotent on already-Grok names
    assert.equal(
      mapClaudeToolsListToGrok('read_file, search_replace, run_terminal_command'),
      'read_file, search_replace, run_terminal_command',
    );
  });

  test('rewrites Write/Read ban phrases and anti-heredoc mandates', () => {
    const src = `
**ALWAYS use the Write tool to create files** — never use \`Bash(cat << 'EOF')\` or heredoc commands for file creation.
If the prompt contains a required_reading block, you MUST use the \`Read\` tool to load every file.
3. **Do NOT use \`Bash(cat << 'EOF')\` or heredoc** for file creation. Use the \`Write\` tool.
`;
    const out = rewriteClaudeToolsToGrok(src);
    assert.match(out, /ALWAYS use search_replace to create files/);
    assert.match(out, /MUST use the `read_file` tool/);
    assert.match(out, /Use the `search_replace` tool/);
    assert.doesNotMatch(out, /Write tool/);
    assert.doesNotMatch(out, /`Read` tool/);
    assert.doesNotMatch(out, /`Bash\(cat/);
    assert.match(out, /run_terminal_command/);
  });

  test('rewrites orchestration + discovery tool call forms', () => {
    const src = `
Agent(
  prompt=ui_research_prompt,
  subagent_type="gsd-ui-researcher",
)
Use AskUserQuestion for the choice.
Task(subagent_type="gsd-planner", prompt="...")
TodoWrite for checklist.
WebSearch and WebFetch for docs.
Codebase Grep/Glob for tokens.
Skill(skill="gsd-plan-phase")
`;
    const out = convertClaudeToGrokMarkdown(src);
    assert.match(out, /spawn_subagent\(/);
    assert.doesNotMatch(out, /\bAgent\(/);
    assert.doesNotMatch(out, /\bTask\(/);
    assert.match(out, /ask_user_question/);
    assert.doesNotMatch(out, /AskUserQuestion/);
    assert.match(out, /todo_write/);
    assert.doesNotMatch(out, /TodoWrite/);
    assert.match(out, /web_search/);
    assert.match(out, /open_page/);
    assert.match(out, /grep\/list_dir/);
    assert.match(out, /open and follow ~\/\.grok\/skills\/gsd-plan-phase\/SKILL\.md/);
  });

  test('ui-researcher-style body no longer mandates Write for UI-SPEC', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'agents', 'gsd-ui-researcher.md'),
      'utf8',
    );
    const out = convertClaudeAgentToGrokAgent(src);
    assert.match(out, /<grok_agent_role>/);
    assert.match(out, /tools: read_file, search_replace/);
    assert.match(out, /ALWAYS use search_replace to create files/);
    assert.doesNotMatch(out, /ALWAYS use the Write tool/);
    assert.doesNotMatch(out, /use the `Read` tool/);
    assert.match(out, /use the `read_file` tool/);
    assert.doesNotMatch(out, /`Bash\(cat << 'EOF'\)`/);
    // Narrative "Write to:" paths may remain; tool-mandate language must not.
    assert.doesNotMatch(out, /Use the `Write` tool/);
  });

  test('ui-phase workflow body maps Agent/AskUserQuestion to Grok tools', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'gsd-core', 'workflows', 'ui-phase.md'),
      'utf8',
    );
    const out = convertClaudeToGrokMarkdown(src);
    assert.match(out, /spawn_subagent\(/);
    assert.doesNotMatch(out, /\bAgent\(/);
    assert.match(out, /ask_user_question/);
    // Remaining AskUserQuestion only acceptable if none
    assert.doesNotMatch(out, /AskUserQuestion/);
    // TEXT_MODE prose may still mention the Claude name as historical — after rewrite it should say ask_user_question
    assert.match(out, /replace every `?ask_user_question`? call/i);
  });

  test('rewriteClaudeToolsToGrok is idempotent', () => {
    const src = 'ALWAYS use the Write tool. Agent(prompt="x") AskUserQuestion TodoWrite Bash(ls)';
    const once = rewriteClaudeToolsToGrok(src);
    const twice = rewriteClaudeToolsToGrok(once);
    assert.equal(twice, once);
  });
});

// ---------------------------------------------------------------------------
// Install integration
// ---------------------------------------------------------------------------

test('grok --global: writes gsd-lifecycle.json + skills/agents under config dir', (t) => {
  const { root, configDir, stdout } = runMinimalInstall({ runtime: 'grok', scope: 'global' });
  t.after(() => cleanup(root));

  const lifecycle = path.join(configDir, 'hooks', GSD_GROK_HOOKS_FILE);
  assert.ok(fs.existsSync(lifecycle), `${lifecycle} must exist after install`);
  const payload = JSON.parse(fs.readFileSync(lifecycle, 'utf8'));
  assert.ok(payload.hooks.SessionStart, 'SessionStart must be registered');
  assert.ok(payload.hooks.PreToolUse, 'PreToolUse must be registered');
  assert.ok(payload.hooks.PostToolUse, 'PostToolUse must be registered');
  assert.ok(payload.hooks.Stop, 'Stop must be registered');

  assert.ok(fs.existsSync(path.join(configDir, 'hooks', 'gsd-check-update.js')),
    'shared hook scripts must install under hooks/');

  // Skills + agents land under the config dir for profile-marker-only.
  const skillsDir = path.join(configDir, 'skills');
  assert.ok(fs.existsSync(skillsDir), 'skills/ must exist');
  const skillSample = fs.readdirSync(skillsDir).find((n) => n.startsWith('gsd-'));
  assert.ok(skillSample, 'at least one gsd-* skill must install');
  const skillMd = path.join(skillsDir, skillSample, 'SKILL.md');
  if (fs.existsSync(skillMd)) {
    const body = fs.readFileSync(skillMd, 'utf8');
    assert.match(body, /<grok_skill_adapter>/);
    assert.match(body, /enter_plan_mode|spawn_subagent/);
    assert.match(body, /search_replace/, 'skill adapter must document search_replace for file create/edit');
  }

  assert.match(stdout, /Grok lifecycle hook/i);

  // Grok expands ${VAR} in hook commands; the #3662 chain token is unusable.
  for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']) {
    const command = payload.hooks[event][0].hooks[0].command;
    assert.doesNotMatch(command, /\$\{n/, `${event} command must not embed \${n}: ${command}`);
    assert.match(command, /gsd-node-runner\.sh/, `${event} must use gsd-node-runner.sh: ${command}`);
  }
  assert.ok(
    fs.existsSync(path.join(configDir, 'hooks', 'gsd-node-runner.sh')),
    'gsd-node-runner.sh must be staged with the shared hooks bundle',
  );
});

test('grok --global: installed agent + ui-phase workflow use Grok tool names', (t) => {
  const { root, configDir } = runMinimalInstall({ runtime: 'grok', scope: 'global' });
  t.after(() => cleanup(root));

  // Agent converter applied: role header + no Write-tool mandate
  const agentPath = path.join(configDir, 'agents', 'gsd-ui-researcher.md');
  assert.ok(fs.existsSync(agentPath), 'gsd-ui-researcher agent must install');
  const agentBody = fs.readFileSync(agentPath, 'utf8');
  assert.match(agentBody, /<grok_agent_role>/);
  assert.match(agentBody, /search_replace/);
  assert.match(agentBody, /read_file/);
  assert.doesNotMatch(agentBody, /ALWAYS use the Write tool/);
  assert.doesNotMatch(agentBody, /use the `Read` tool/);

  // Pack workflows rewritten via RUNTIME_CONTENT_DISPATCH.grok
  const uiPhasePath = path.join(configDir, 'gsd-core', 'workflows', 'ui-phase.md');
  assert.ok(fs.existsSync(uiPhasePath), 'ui-phase workflow must install under gsd-core/workflows');
  const workflowBody = fs.readFileSync(uiPhasePath, 'utf8');
  assert.match(workflowBody, /spawn_subagent\(/);
  assert.doesNotMatch(workflowBody, /\bAgent\(/);
  assert.match(workflowBody, /ask_user_question/);
  assert.doesNotMatch(workflowBody, /AskUserQuestion/);

  // ui-phase skill still points at the rewritten workflow
  const skillPath = path.join(configDir, 'skills', 'gsd-ui-phase', 'SKILL.md');
  if (fs.existsSync(skillPath)) {
    const skillBody = fs.readFileSync(skillPath, 'utf8');
    assert.match(skillBody, /<grok_skill_adapter>/);
    assert.match(skillBody, /File I\/O and shell/);
    assert.match(skillBody, /search_replace/);
  }
});
