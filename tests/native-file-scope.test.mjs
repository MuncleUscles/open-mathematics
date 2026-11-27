import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {run} from '../scripts/agent.mjs';

const selectedText = 'This public fixture belongs to the selected contributor worktree.';
const outsideText = 'This public fixture belongs to a directory outside the worktree.';
const nativeInputs = [
  ['challenge', 'contribution-fixture'],
  ['case-challenge', 'provisional-case-fixture'],
  ['case-withdraw', 'submitted-case-fixture'],
];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'open-math-evidence-'));
  const cwd = process.cwd(), signerFile = process.env.CONTRIBUTOR_KEY_FILE, exitCode = process.exitCode;
  const launchDir = path.join(root, 'launch'), worktree = path.join(root, 'selected');
  fs.mkdirSync(launchDir);
  fs.mkdirSync(worktree);
  process.chdir(launchDir);
  delete process.env.CONTRIBUTOR_KEY_FILE;
  t.after(() => {
    process.chdir(cwd);
    if (signerFile !== undefined) process.env.CONTRIBUTOR_KEY_FILE = signerFile;
    process.exitCode = exitCode;
    fs.rmSync(root, {recursive: true, force: true});
  });
  const output = [], diagnostics = [], reads = [];
  t.mock.method(console, 'log', line => output.push(JSON.parse(line)));
  t.mock.method(console, 'error', line => diagnostics.push(JSON.parse(line)));
  const clientFor = () => ({
    async readContract({functionName, args}) {
      reads.push(functionName);
      if (functionName === 'get_problem') return {id: 'p-vs-np', status: 'open'};
      return {status: args[0] === 'submitted-case-fixture' ? 'submitted' : 'provisional', round: 0, deadline: 4_000_000_000};
    },
  });
  const preview = async (...args) => {
    output.length = 0;
    diagnostics.length = 0;
    await run(['--worktree', worktree, ...args], {clientFor});
    return {output: output[0], error: diagnostics[0]};
  };
  return {root, launchDir, worktree, preview, reads};
}

function report(claim) {
  return {
    claim,
    component: 'Public input fixture',
    sources: [{
      reference: 'https://example.org/public-source', title: 'Public documentary fixture', authors: ['Example author'],
      relationship: 'The source URL is used to validate the fixture input shape.',
      priority_evidence: 'The fixture makes no priority claim or new mathematical report.',
    }],
  };
}

test('relative native evidence inputs use the selected worktree over files with the same names in the launch directory', async t => {
  const f = fixture(t);
  for (const [root, text] of [[f.launchDir, outsideText], [f.worktree, selectedText]]) {
    fs.writeFileSync(path.join(root, 'evidence.txt'), text);
    fs.writeFileSync(path.join(root, 'case.json'), JSON.stringify(report(text)));
  }
  for (const [command, id] of nativeInputs) {
    const {output, error} = await f.preview(command, id, 'evidence.txt');
    assert.equal(error, undefined);
    assert.deepEqual(output.args, [id, selectedText]);
  }
  const {output, error} = await f.preview('case-report', 'external-solution', 'p-vs-np', 'case.json');
  assert.equal(error, undefined);
  assert.equal(JSON.parse(output.args[2]).claim, selectedText);
});

test('relative evidence cannot follow a symlink outside the worktree', async t => {
  const f = fixture(t), outside = path.join(f.root, 'public-note.txt');
  fs.writeFileSync(outside, outsideText);
  fs.symlinkSync(outside, path.join(f.worktree, 'evidence.txt'));
  for (const [command, id] of nativeInputs) {
    const {output, error} = await f.preview(command, id, 'evidence.txt');
    assert.equal(output, undefined);
    assert.match(error.error, /Symlink escapes contributor worktree/);
  }
  const {output, error} = await f.preview('case-report', 'external-solution', 'p-vs-np', 'evidence.txt');
  assert.equal(output, undefined);
  assert.match(error.error, /Symlink escapes contributor worktree/);
  assert.deepEqual(f.reads, []);
});

test('an explicitly chosen absolute public evidence file remains supported', async t => {
  const f = fixture(t), outside = path.join(f.root, 'public-note.txt');
  fs.writeFileSync(outside, outsideText);
  const {output, error} = await f.preview('case-challenge', 'provisional-case-fixture', outside);
  assert.equal(error, undefined);
  assert.equal(output.args[1], outsideText);
});
