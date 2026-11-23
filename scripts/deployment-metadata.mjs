// Browser read configuration only. Full receipts remain in deployment.json.
// An explicit projection prevents future deployment payloads leaking into every
// page load, while retaining all fields used to bind a published snapshot.
export function deploymentMetadata(deployment){
 if(!deployment||typeof deployment!=='object'||Array.isArray(deployment))throw Error('Deployment metadata requires an object');
 const {protocolVersion,contract,chainId,codeHash,policy}=deployment;
 if(!Number.isSafeInteger(protocolVersion)||protocolVersion<1||
    !Number.isSafeInteger(chainId)||chainId<1||
    typeof contract!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(contract)||
    typeof codeHash!=='string'||!/^[0-9a-f]{64}$/.test(codeHash)||
    typeof policy!=='string'||!/^[0-9a-f]{64}$/.test(policy))throw Error('Invalid deployment binding metadata');
 return {protocolVersion,contract,chainId,codeHash,policy};
}
