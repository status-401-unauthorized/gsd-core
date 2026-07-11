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
  }

  assert.match(stdout, /Grok lifecycle hook/i);
});
