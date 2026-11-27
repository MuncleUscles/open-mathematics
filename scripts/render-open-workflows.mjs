// Generate literal, reviewed cross-repository pins. Never select a PR ref.
import fs from 'node:fs';import path from 'node:path';import {isCommit} from '../src/problem.mjs';
const [directory,protocolCommit]=process.argv.slice(2);if(!directory||!isCommit(protocolCommit))throw Error('Usage: render-open-workflows.mjs PROBLEM_DIR PROTOCOL_SHA');
const descriptor=JSON.parse(fs.readFileSync(path.join(directory,'.open-math/open.json'),'utf8'));
if(descriptor.schemaVersion!==5||!['MuncleUscles/pnp.fun','MuncleUscles/open-mathematics'].includes(descriptor.protocol.repository)||descriptor.protocol.commit!==protocolCommit)throw Error('Workflow pin must equal the reviewed open descriptor');
const accountsFile=path.join(directory,'.open-math/github-accounts.json');
if(fs.existsSync(accountsFile)){
 const accounts=JSON.parse(fs.readFileSync(accountsFile,'utf8'));
 // Account synchronization uses the same protocol checkout as every other job.
 if(accounts?.implementationCommit!==protocolCommit)throw Error('GitHub account implementation pin must equal the workflow protocol commit');
}
const policy=JSON.parse(fs.readFileSync(path.join(directory,descriptor.policy.path),'utf8'));
const buildScript=policy.version===6?'github/build-full-lean.sh':'github/build-verifier.sh';
const checkouts=`      - name: Read this exact reviewed problem configuration
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          ref: \${{ github.sha }}
          path: problem
          persist-credentials: false
      - name: Read the pinned protocol implementation
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          repository: MuncleUscles/pnp.fun
          ref: ${protocolCommit}
          path: protocol
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: 22.22.0
          cache: npm
          cache-dependency-path: protocol/package-lock.json
      - run: npm ci --ignore-scripts
`;
const research=`name: Open research adjudication
on:
  issue_comment:
    types: [created]
  workflow_dispatch:
    inputs:
      comment_id:
        description: Original PR-author signed comment ID to process or resume
        required: false
        type: string
  schedule:
    - cron: '*/15 * * * *'
permissions:
  contents: write
  pull-requests: write
  checks: write
jobs:
  process:
    if: >-
      github.ref == 'refs/heads/main' &&
      (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' ||
      (github.event.action == 'created' && github.event.issue.pull_request && (startsWith(github.event.comment.body, 'Open-Mathematics-Claim: ') || startsWith(github.event.comment.body, 'Open-Mathematics-Process: ') || startsWith(github.event.comment.body, 'Open-Mathematics-Retry: '))))
    environment: protocol
    concurrency:
      group: research-executor
      cancel-in-progress: false
    runs-on: ubuntu-24.04
    timeout-minutes: 50
    defaults:
      run:
        working-directory: protocol
    env:
      OPEN_MATH_PROBLEM_DIR: \${{ github.workspace }}/problem
    steps:
${checkouts}      - name: Select a valid signed claim
        id: claim
        run: node github/open-select.mjs
        env:
          GITHUB_TOKEN: \${{ github.token }}
      - name: Build pinned isolated Lean
        if: steps.claim.outputs.comment_id != '' && steps.claim.outputs.needs_lean != 'false'
        run: bash ${buildScript}
      - name: Verify and implement GenLayer's final decision
        if: steps.claim.outputs.comment_id != ''
        run: node github/open-worker.mjs
        env:
          REVIEW_RETRY_HASH: \${{ steps.claim.outputs.retry_hash }}
          CLAIM_COMMENT_ID: \${{ steps.claim.outputs.comment_id }}
          GITHUB_TOKEN: \${{ github.token }}
          VERIFIER_SIGNING_KEY: \${{ secrets.VERIFIER_SIGNING_KEY }}
          EXECUTOR_SIGNING_KEY: \${{ secrets.EXECUTOR_SIGNING_KEY }}
  accounts:
    needs: process
    if: >-
      always() && !cancelled() && needs.process.result != 'skipped' &&
      github.ref == 'refs/heads/main'
    environment: protocol
    concurrency:
      group: research-executor
      cancel-in-progress: false
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    defaults:
      run:
        working-directory: protocol
    env:
      OPEN_MATH_PROBLEM_DIR: \${{ github.workspace }}/problem
    steps:
${checkouts}      - name: Reconcile native GitHub identity and points
        run: node github/sync-accounts.mjs ../problem
        env:
          GITHUB_TOKEN: \${{ github.token }}
          EXECUTOR_SIGNING_KEY: \${{ secrets.EXECUTOR_SIGNING_KEY }}
`;
const federation=`name: Research federation
on:
  workflow_dispatch:
    inputs:
      operation:
        description: Native federation operation
        required: true
        type: choice
        options: [register, attribution, reconcile-impact, verify-author, settle-author]
      payload:
        description: Exact native ID, or bounded source/author JSON request
        required: true
        type: string
permissions:
  contents: write
jobs:
  process:
    if: github.ref == 'refs/heads/main'
    environment: protocol
    concurrency:
      group: research-executor
      cancel-in-progress: false
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    defaults:
      run:
        working-directory: protocol
    env:
      OPEN_MATH_PROBLEM_DIR: \${{ github.workspace }}/problem
    steps:
${checkouts}      - name: Process exact federation evidence and native decision
        run: node github/run-federation.mjs
        env:
          FEDERATION_OPERATION: \${{ inputs.operation }}
          FEDERATION_PAYLOAD: \${{ inputs.payload }}
          GITHUB_TOKEN: \${{ github.token }}
          VERIFIER_SIGNING_KEY: \${{ secrets.VERIFIER_SIGNING_KEY }}
          EXECUTOR_SIGNING_KEY: \${{ secrets.EXECUTOR_SIGNING_KEY }}
      - name: Refresh registered native account identities
        if: always() && !cancelled()
        run: node github/sync-accounts.mjs ../problem
        env:
          GITHUB_TOKEN: \${{ github.token }}
          EXECUTOR_SIGNING_KEY: \${{ secrets.EXECUTOR_SIGNING_KEY }}
`;
fs.mkdirSync(path.join(directory,'.github/workflows'),{recursive:true});for(const [name,value]of Object.entries({'research.yml':research,'federation.yml':federation}))fs.writeFileSync(path.join(directory,'.github/workflows',name),value);
console.log(JSON.stringify({protocolCommit,files:['research.yml','federation.yml']}));
