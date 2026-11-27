// Compatibility entry point; all validation stays in the trusted agent helper.
import {run} from './agent.mjs';
const [pr,record]=process.argv.slice(2);
if(!pr||!record)throw Error('Use: CONTRIBUTOR_KEY_FILE=/private/path node scripts/sign-claim.mjs PR research/submissions/SLUG.json');
await run(['sign',pr,record]);
