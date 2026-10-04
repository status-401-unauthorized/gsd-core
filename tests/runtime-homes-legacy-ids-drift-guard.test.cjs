'use strict';

/**
 * #3024 review finding 2 — drift guard for LEGACY_NON_REGISTRY_RUNTIME_IDS,
 * rebuilt for #5169 (ADR-5057 Phase 10).
 *
 * isRegisteredRuntimeId() accepts an id if it is either a capability-registry
 * key or a member of LEGACY_NON_REGISTRY_RUNTIME_IDS. Upstream's table is
 * currently just `grok` (`~/.agents`). On this fork the table is empty:
 * `grok` is a registry runtime (`~/.grok` / `GROK_HOME`) and must not be
 * re-listed. The #3024 regression was a second hand-maintained proxy for
 * "does this id have a genuine runtime-specific resolution?"
 *
 * Phase 10 removed the proxy: the legacy ids are the KEYS of one data table,
 * `LEGACY_NON_REGISTRY_RUNTIME_HOMES` (src/runtime-name-policy.cts), which
 * both the id set and `getGlobalConfigDir` read. This guard asserts:
 *   - the id set IS the table's key set, and is disjoint from the registry
 *     (empty is valid on this fork);
 *   - every legacy id resolves runtime-specifically — never to the generic
 *     default;
 *   - grok is registered, not legacy, and resolves to ~/.grok;
 *   - a registered id and a legacy id are KNOWN; an unregistered id refuses
 *     instead of resolving to the generic default (#5169).
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'gsd-core', 'bin', 'lib');

const {
  getGlobalConfigDir,
  isRegisteredRuntimeId,
  LEGACY_NON_REGISTRY_RUNTIME_IDS,
} = require(path.join(LIB, 'runtime-homes.cjs'));
const { LEGACY_NON_REGISTRY_RUNTIME_HOMES } = require(path.join(LIB, 'runtime-name-policy.cjs'));
const { runtimes } = require(path.join(LIB, 'capability-registry.cjs'));

// A sentinel id that is definitely unregistered and has no dedicated branch.
const SENTINEL_ID = 'zzz-not-a-runtime-3024-drift-guard';

/**
 * Every env var a descriptor-driven runtime or a legacy home reads to override
 * its resolved directory. Derived from the registry and the legacy table (never
 * hand-copied), and cleared for the duration of each test so an ambient variable
 * in the runner's environment cannot change a resolved path under the assertions.
 */
function collectEnvVars() {
  const vars = new Set(Object.values(LEGACY_NON_REGISTRY_RUNTIME_HOMES).map((legacy) => legacy.env));
  for (const entry of Object.values(runtimes)) {
    const configHome = entry.runtime?.configHome;
    if (configHome?.env) configHome.env.forEach((v) => vars.add(v));
    if (configHome?.skillsHome?.env) configHome.skillsHome.env.forEach((v) => vars.add(v));
  }
  assert.ok(vars.size > 1, 'EMPTY CAPTURE: derived zero env vars from the registry and the legacy table');
  return vars;
}

function clearEnv(keys) {
  const saved = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  return saved;
}

function restoreEnv(saved) {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('#3024 review finding 2: LEGACY_NON_REGISTRY_RUNTIME_IDS drift guard (#5169: table-derived)', () => {
  test('the legacy id set is exactly the key set of the legacy home table, and is disjoint from the registry', () => {
    const tableIds = Object.keys(LEGACY_NON_REGISTRY_RUNTIME_HOMES).sort();
    // Empty is valid on this fork: grok is a registry runtime, not a legacy id.
    assert.deepStrictEqual([...LEGACY_NON_REGISTRY_RUNTIME_IDS].sort(), tableIds);
    for (const id of tableIds) {
      assert.ok(!Object.prototype.hasOwnProperty.call(runtimes, id), `${id} is registered AND legacy-listed`);
    }
  });

  test('every legacy id resolves runtime-specifically: its own default, its own env override', (t) => {
    const saved = clearEnv(collectEnvVars());
    t.after(() => restoreEnv(saved));

    const generic = getGlobalConfigDir('');
    for (const [id, legacy] of Object.entries(LEGACY_NON_REGISTRY_RUNTIME_HOMES)) {
      const resolved = getGlobalConfigDir(id);
      assert.notStrictEqual(resolved, generic, `${id} must not resolve to the generic default`);
      assert.strictEqual(resolved, path.join(os.homedir(), ...legacy.dir), `${id} default`);

      process.env[legacy.env] = '/custom/legacy-home';
      try {
        assert.strictEqual(String(getGlobalConfigDir(id)).replace(/\\/g, '/'), '/custom/legacy-home', `${id} env override`);
      } finally {
        delete process.env[legacy.env];
      }
    }
  });

  test('grok is a registry runtime and resolves to ~/.grok, not the upstream legacy ~/.agents row', (t) => {
    assert.ok(!LEGACY_NON_REGISTRY_RUNTIME_IDS.has('grok'));
    assert.ok(Object.prototype.hasOwnProperty.call(runtimes, 'grok'));
    assert.ok(isRegisteredRuntimeId('grok'));
    const saved = clearEnv(collectEnvVars());
    t.after(() => restoreEnv(saved));
    assert.strictEqual(getGlobalConfigDir('grok'), path.join(os.homedir(), '.grok'));
    process.env.GROK_HOME = '/custom/grok-home';
    assert.strictEqual(String(getGlobalConfigDir('grok')).replace(/\\/g, '/'), '/custom/grok-home');
  });

  test('every registered id and every legacy id is KNOWN; an unregistered id is not', () => {
    for (const id of [...Object.keys(runtimes), ...LEGACY_NON_REGISTRY_RUNTIME_IDS]) {
      assert.ok(isRegisteredRuntimeId(id), `${id} must be known`);
    }
    assert.ok(!Object.prototype.hasOwnProperty.call(runtimes, SENTINEL_ID));
    assert.ok(!LEGACY_NON_REGISTRY_RUNTIME_IDS.has(SENTINEL_ID));
    assert.strictEqual(isRegisteredRuntimeId(SENTINEL_ID), false);
  });

  // #4709 AC#1 / #5169: neither a retired id nor a merely-unknown id falls back
  // to the generic default any more — both refuse, with distinct errors.
  test('an unregistered id with no dedicated branch REFUSES; a retired id refuses with the retirement error', (t) => {
    const saved = clearEnv(collectEnvVars());
    t.after(() => restoreEnv(saved));

    assert.throws(() => getGlobalConfigDir(SENTINEL_ID), { name: 'UnknownRuntimeError' });
    assert.throws(() => getGlobalConfigDir('notarealruntime'), { name: 'UnknownRuntimeError' });
    assert.throws(
      () => getGlobalConfigDir('gemini'),
      /retired by #1928/,
      'gemini must refuse with RetiredRuntimeError, distinct from an unknown id',
    );
  });
});
