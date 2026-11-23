// Generate literal, reviewed cross-repository pins. Never select a PR ref.
import fs from 'node:fs';import path from 'node:path';import {isCommit} from '../src/problem.mjs';
const [directory,protocolCommit]=process.argv.slice(2);if(!directory||!isCommit(protocolCommit))throw Error('Usage: render-open-workflows.mjs PROBLEM_DIR PROTOCOL_SHA');
const descriptor=JSON.parse(fs.readFileSync(path.join(directory,'.open-math/open.json'),'utf8'));
if(descriptor.schemaVersion!==5||descriptor.protocol.repository!=='MuncleUscles/open-mathematics'||descriptor.protocol.commit!==protocolCommit)throw Error('Workflow pin must equal the reviewed open descriptor');
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
          repository: MuncleUscles/open-mathematics
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
      (github.event.action == 'created' && github.event.issue.pull_request && startsWith(github.event.comment.body, 'Open-Mathematics-Claim: ')))
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
const pages=`name: Open research dashboard
on:
  push:
    branches: [main]
  workflow_dispatch:
  workflow_run:
    workflows: [Open research adjudication, Research federation]
    types: [completed]
    branches: [main]
permissions:
  contents: read
  actions: read
  pages: write
  id-token: write
concurrency:
  group: github-pages
  cancel-in-progress: false
jobs:
  deploy:
    if: >-
      github.ref == 'refs/heads/main' &&
      (github.event_name != 'workflow_run' ||
      (github.event.workflow_run.head_branch == 'main' &&
      github.event.workflow_run.head_repository.full_name == github.repository))
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    defaults:
      run:
        working-directory: protocol
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
${checkouts}      - name: Build dashboard with a dated finalized-native snapshot
        run: node scripts/build-open-site.mjs ../problem ../site --snapshot
      - uses: actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b
      - uses: actions/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b
        id: upload
        with:
          path: site
          retention-days: 1
      - name: Wait for this run's exact uploaded artifact
        timeout-minutes: 5
        env:
          GITHUB_TOKEN: \${{ github.token }}
          PAGES_ARTIFACT_ID: \${{ steps.upload.outputs.artifact_id }}
        run: node github/wait-pages-artifact.mjs
      - name: Publish problem dashboard
        id: deployment
        uses: actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e
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
fs.mkdirSync(path.join(directory,'.github/workflows'),{recursive:true});for(const [name,value]of Object.entries({'research.yml':research,'pages.yml':pages,'federation.yml':federation}))fs.writeFileSync(path.join(directory,'.github/workflows',name),value);
console.log(JSON.stringify({protocolCommit,files:['research.yml','pages.yml','federation.yml']}));
