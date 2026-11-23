// Compatibility entry point. V2 uses the committed submission path, not loose metadata.
const [pr,record]=process.argv.slice(2);
if(!pr||!record)throw Error('Use: CONTRIBUTOR_KEY_FILE=/private/path node scripts/sign-claim.mjs PR research/submissions/SLUG.json');
process.argv=[process.argv[0],process.argv[1],'sign',pr,record];
await import('./agent.mjs');
