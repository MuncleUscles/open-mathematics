import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {loadOpenProblem, verifyOpenCheckout} from '../src/open-research.mjs';
import {collectOpenSnapshot} from '../src/open-snapshot.mjs';
import {withStudioBatchPacing} from '../github/batch-studio-client.mjs';

export async function writeOpenSnapshot({problem, destination, read, now}) {
  const pending = destination + '.pending';
  // A failed capture must not leave an old snapshot under a new build's date.
  fs.rmSync(destination, {force: true});
  fs.rmSync(pending, {force: true});
  try {
    const snapshot = await collectOpenSnapshot({problem, read, now});
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.writeFileSync(pending, JSON.stringify(snapshot));
    fs.renameSync(pending, destination);
    return snapshot;
  } catch (error) {
    fs.rmSync(pending, {force: true});
    throw error;
  }
}

async function main() {
  const [directory, destination, ...extra] = process.argv.slice(2);
  if (!directory || !destination || extra.length) throw Error('Usage: capture-open-ledger.mjs TRUSTED_PROBLEM OUTPUT_JSON');
  const problem = loadOpenProblem(directory), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  verifyOpenCheckout(problem, root);
  const client = withStudioBatchPacing(createClient({chain: studionet}));
  let chainChecked = false;
  const snapshot = await writeOpenSnapshot({problem, destination, read: async (functionName, args) => {
    if (!chainChecked) {
      if (Number(await client.getChainId()) !== problem.deployment.chainId) throw Error('Wrong native chain');
      chainChecked = true;
    }
    return client.readContract({address: problem.deployment.contract, functionName, args, transactionHashVariant: 'latest-final'});
  }});
  console.log(JSON.stringify({contract: snapshot.identity.contract, completedAt: snapshot.completedAt,
    records: snapshot.records.length, readCalls: snapshot.reads.length, readOnly: true}));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
