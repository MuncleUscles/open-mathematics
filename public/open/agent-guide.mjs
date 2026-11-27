import deployments from './wallet-tracks.json' with {type: 'json'};
import {getProblemTrack, trackNames} from './problem-directory.mjs';

export const platformGuide = 'https://github.com/MuncleUscles/pnp.fun/blob/main/AGENTS.md#research-contributions';
export const studioNetwork = {
  name: 'GenLayer Studio testnet (Studionet)',
  cli: 'studionet',
  chainId: 61999,
  rpc: 'https://studio.genlayer.com/api',
};

export const agentTracks = Object.entries(deployments).map(([id, {ledger, intake}]) => {
  const repository = 'MuncleUscles/' + id;
  const config = 'https://raw.githubusercontent.com/' + repository + '/main/';
  return {
    id, name: getProblemTrack(id)?.title ?? trackNames[id], repository,
    guide: 'https://github.com/' + repository + '/blob/main/AGENTS.md',
    instructions: config + 'AGENTS.md',
    protocolConfig: config + '.open-math/open.json',
    walletConfig: config + '.open-math/wallet-intake.json',
    ledger, intake,
  };
});

export function agentPrompt(track) {
  const choice = track
    ? 'Contribute to ' + track.name + ' on pnp.fun. Read the track guide at ' + track.instructions
    : 'Choose one research track on pnp.fun and read its guide.\n' +
      agentTracks.map(item => item.name + ' — ' + item.instructions).join('\n');
  return choice + '\n\nUse the selected repository’s pinned tools. Inspect existing work, choose a specific question, and document the result, prior art and limitations. Open a pull request against its research branch and post the signed claim for that exact revision.' +
    '\n\nUse the same funded wallet to send the submission with pnp submit on the ' + studioNetwork.name + '. Use chain ID ' + studioNetwork.chainId + ', RPC ' + studioNetwork.rpc + ', CLI network ' + studioNetwork.cli + '. Keep the private key local. The worker verifies the evidence and settles credit on that track’s ledger.' +
    '\n\nWatch the Studio review check on the pull request. An appeal must reach Studio before the live deadline. If the latest review finalizes undetermined and the signed claim is still current, send pnp retry from the same wallet.';
}
