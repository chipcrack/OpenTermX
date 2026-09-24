import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTs(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 }
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const { createHostKeyInvoker, HostKeyVerificationError, parseHostKeyNotice } =
  await loadTs('../src/services/hostKeyProtocol.ts');
const { terminalZoomAction, clampTerminalFontSize, shouldBlockTerminalReload } = await loadTs('../src/utils/terminalShortcuts.ts');
const unknown = {
  code: 'unknown', host: 'example.test', port: 22, algorithm: 'Ed25519',
  fingerprint: 'SHA256:abc', expectedFingerprint: null, token: '1'
};
const errorFor = (notice) => `SSH_HOST_KEY:${JSON.stringify(notice)}`;

test('first connection waits for approval; terminal and SFTP share a single confirmation', async () => {
  let approved = false;
  let confirmations = 0;
  let resolutions = 0;
  const secureInvoke = createHostKeyInvoker(async (command, args) => {
    if (command === 'resolve_host_key') {
      resolutions++;
      approved = args.accept;
      return;
    }
    if (!approved) throw errorFor(unknown);
    return command;
  }, async () => { confirmations++; return true; });
  assert.deepEqual(await Promise.all([secureInvoke('open_terminal'), secureInvoke('list_directory')]),
    ['open_terminal', 'list_directory']);
  assert.equal(confirmations, 1);
  assert.equal(resolutions, 1);
});

test('cancellation never retries the connection', async () => {
  let connections = 0;
  const secureInvoke = createHostKeyInvoker(async (command, args) => {
    if (command === 'resolve_host_key') { assert.equal(args.accept, false); return; }
    connections++;
    throw errorFor(unknown);
  }, async () => false);
  await assert.rejects(secureInvoke('open_terminal'), HostKeyVerificationError);
  assert.equal(connections, 1);
});

test('late concurrent host challenges reuse the confirmed decision', async () => {
  let resolutions = 0;
  let confirmations = 0;
  let calls = 0;
  const secureInvoke = createHostKeyInvoker(async (command) => {
    if (command === 'resolve_host_key') { resolutions++; return; }
    calls++;
    if (calls === 1 || calls === 3) throw errorFor(unknown);
    return 'connected';
  }, async () => { confirmations++; return true; });
  assert.equal(await secureInvoke('open_terminal'), 'connected');
  assert.equal(await secureInvoke('list_directory'), 'connected');
  assert.equal(confirmations, 1);
  assert.equal(resolutions, 1);
});

test('changed key is blocked without offering to accept it', async () => {
  let confirmations = 0;
  const secureInvoke = createHostKeyInvoker(async () => {
    throw errorFor({ ...unknown, code: 'changed', expectedFingerprint: 'SHA256:old', token: null });
  }, async () => { confirmations++; return true; });
  await assert.rejects(secureInvoke('open_terminal'), /SHA256:old/);
  assert.equal(confirmations, 0);
});

test('a key changing between approval and reconnection is blocked', async () => {
  let connections = 0;
  const secureInvoke = createHostKeyInvoker(async (command) => {
    if (command === 'resolve_host_key') return;
    connections++;
    throw errorFor(connections === 1 ? unknown : {
      ...unknown, code: 'changed', fingerprint: 'SHA256:attacker', expectedFingerprint: unknown.fingerprint, token: null
    });
  }, async () => true);
  await assert.rejects(secureInvoke('open_terminal'), HostKeyVerificationError);
  assert.equal(connections, 2);
});

test('storage failures block retry and normal errors retain their original behavior', async () => {
  let connections = 0;
  const secureInvoke = createHostKeyInvoker(async (command) => {
    if (command === 'resolve_host_key') throw 'database unavailable';
    connections++;
    throw errorFor(unknown);
  }, async () => true);
  await assert.rejects(secureInvoke('open_terminal'), HostKeyVerificationError);
  assert.equal(connections, 1);
  const failure = new Error('connection timeout');
  const failedInvoke = createHostKeyInvoker(async () => { throw failure; }, async () => assert.fail());
  await assert.rejects(failedInvoke('open_terminal'), (error) => error === failure);
  assert.equal(parseHostKeyNotice('SSH_HOST_KEY:{broken'), null);
  assert.equal(parseHostKeyNotice('SSH_HOST_KEY:null'), null);
});

test('zoom supports Ctrl, Cmd, shifted + and numeric keypad without taking shell keys', () => {
  const event = { key: '', code: '', ctrlKey: false, metaKey: false, altKey: false };
  for (const modifier of ['ctrlKey', 'metaKey']) {
    for (const key of ['+', '=']) assert.equal(terminalZoomAction({ ...event, [modifier]: true, key }), 'in');
    assert.equal(terminalZoomAction({ ...event, [modifier]: true, key: '-' }), 'out');
    assert.equal(terminalZoomAction({ ...event, [modifier]: true, key: '0' }), 'reset');
    assert.equal(terminalZoomAction({ ...event, [modifier]: true, code: 'NumpadAdd' }), 'in');
    assert.equal(terminalZoomAction({ ...event, [modifier]: true, code: 'NumpadSubtract' }), 'out');
  }
  for (const key of ['c', 'd', 'z', 'l', 'r', 'a']) {
    assert.equal(terminalZoomAction({ ...event, ctrlKey: true, key }), null);
  }
  assert.equal(terminalZoomAction({ ...event, key: '+' }), null);
  assert.equal(terminalZoomAction({ ...event, ctrlKey: true, altKey: true, key: '+' }), null);
});

test('font size remains bounded and invalid preferences use the default', () => {
  assert.equal(clampTerminalFontSize(100), 32);
  assert.equal(clampTerminalFontSize(-1), 8);
  assert.equal(clampTerminalFontSize(NaN), 13);
  assert.equal(clampTerminalFontSize(Infinity), 13);
  assert.equal(clampTerminalFontSize(16.6), 17);
});

test('shell history and reconnection work while browser reload stays blocked', () => {
  const event = { key: 'r', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  assert.equal(shouldBlockTerminalReload(event, true), false);
  assert.equal(shouldBlockTerminalReload({ ...event, shiftKey: true }, true), false);
  assert.equal(shouldBlockTerminalReload({ ...event, ctrlKey: false, metaKey: true, shiftKey: true }, true), false);
  assert.equal(shouldBlockTerminalReload(event, false), true);
  assert.equal(shouldBlockTerminalReload({ ...event, shiftKey: true }, false), true);
  assert.equal(shouldBlockTerminalReload({ ...event, ctrlKey: false, metaKey: true }, true), true);
  assert.equal(shouldBlockTerminalReload({ ...event, key: 'F5' }, true), true);
  assert.equal(shouldBlockTerminalReload({ ...event, key: 'c' }, true), false);
});
