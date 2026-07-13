#!/usr/bin/env node

import assert from 'node:assert/strict';
import { FORK_DIVERGENCE_RESOLUTION_OPTION, buildForkDivergenceBlockedReason, buildForkDivergenceFailureActionSection } from '../src/solve.branch-divergence.lib.mjs';
import { notifyIssueAboutPrePullRequestFailure } from '../src/solve.pre-pr-failure-notifier.lib.mjs';
import { resetTrackedToolCommentIds } from '../src/tool-comments.lib.mjs';

async function test(name, fn) {
  try {
    resetTrackedToolCommentIds();
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

const safeSnapshot = {
  forkedRepo: 'petermotorniy/auto-programmer',
  upstreamRepo: 'PeterMotorniy/auto-programmer',
  branchName: 'main',
  forkRef: 'origin/main',
  upstreamRef: 'upstream/main',
  forkUniqueCount: 0,
  upstreamUniqueCount: 3,
  uniqueCommits: [],
  compareUrl: 'https://github.com/PeterMotorniy/auto-programmer/compare/main...petermotorniy:main',
};

const unsafeSnapshot = {
  forkedRepo: 'contributor/auto-programmer',
  upstreamRepo: 'PeterMotorniy/auto-programmer',
  branchName: 'main',
  forkRef: 'origin/main',
  upstreamRef: 'upstream/main',
  forkUniqueCount: 2,
  upstreamUniqueCount: 5,
  uniqueCommits: [
    {
      sha: '1234567890abcdef1234567890abcdef12345678',
      shortSha: '1234567890ab',
      author: 'Alice',
      subject: 'Keep local deployment notes',
    },
    {
      sha: 'fedcba0987654321fedcba0987654321fedcba09',
      shortSha: 'fedcba098765',
      author: 'Bob',
      subject: 'Preserve fork-only config',
    },
  ],
  compareUrl: 'https://github.com/PeterMotorniy/auto-programmer/compare/main...contributor:main',
};

await test('same-user fork divergence guidance recommends the guarded flag only after a zero-unique-commit check', () => {
  const section = buildForkDivergenceFailureActionSection({
    snapshot: safeSnapshot,
    currentUser: 'petermotorniy',
    taskRequester: 'petermotorniy',
    solveCommand: 'solve https://github.com/PeterMotorniy/auto-programmer/issues/2009',
  });

  assert.match(section, /0 commit\(s\) unique to `origin\/main`/);
  assert.match(section, new RegExp(FORK_DIVERGENCE_RESOLUTION_OPTION));
  assert.match(section, /gh repo delete petermotorniy\/auto-programmer --yes/);
  assert.match(section, /git push --force-with-lease origin main/);
  assert.doesNotMatch(section, /If the fork's default branch can be overwritten safely/);
  assert.doesNotMatch(section, /If this requires elevated Auto Programmer access/);
  assert.doesNotMatch(section, /Administrator-only CLI details/);
});

await test('different-user safe fork divergence guidance asks an administrator to rerun with the guarded flag', () => {
  const section = buildForkDivergenceFailureActionSection({
    snapshot: safeSnapshot,
    currentUser: 'auto-programmer-bot',
    taskRequester: 'petermotorniy',
    solveCommand: 'solve https://github.com/PeterMotorniy/auto-programmer/issues/2009',
  });

  assert.match(section, /0 commit\(s\) unique to `origin\/main`/);
  assert.match(section, /Ask a Auto Programmer administrator to rerun with/);
  assert.match(section, new RegExp(FORK_DIVERGENCE_RESOLUTION_OPTION));
  assert.doesNotMatch(section, /If this requires elevated Auto Programmer access/);
});

await test('different-user fork divergence guidance lists the exact commits that would be lost and asks an administrator', () => {
  const section = buildForkDivergenceFailureActionSection({
    snapshot: unsafeSnapshot,
    currentUser: 'auto-programmer-bot',
    taskRequester: 'petermotorniy',
    solveCommand: 'solve https://github.com/PeterMotorniy/auto-programmer/issues/2009',
  });

  assert.match(section, /2 commit\(s\) unique to `origin\/main`/);
  assert.match(section, /1234567890ab Alice Keep local deployment notes/);
  assert.match(section, /fedcba098765 Bob Preserve fork-only config/);
  assert.match(section, /Ask a Auto Programmer administrator to handle manual recreation or fix of the repository/);
  assert.doesNotMatch(section, new RegExp(FORK_DIVERGENCE_RESOLUTION_OPTION));
  assert.doesNotMatch(section, /Administrator-only CLI details/);
});

await test('fork divergence reason preserves inspected repository data for the failure block', () => {
  const reason = buildForkDivergenceBlockedReason({ snapshot: unsafeSnapshot });

  assert.match(reason, /^Repository setup halted - fork divergence requires user decision\./);
  assert.match(reason, /Fork: contributor\/auto-programmer/);
  assert.match(reason, /Upstream: PeterMotorniy\/auto-programmer/);
  assert.match(reason, /Fork-only commits that would be overwritten: 2/);
  assert.match(reason, /1234567890ab Alice Keep local deployment notes/);
});

await test('pre-exit notification uses the explicit action section instead of regenerating generic fork guidance', async () => {
  const failureActionSection = buildForkDivergenceFailureActionSection({
    snapshot: unsafeSnapshot,
    currentUser: 'auto-programmer-bot',
    taskRequester: 'petermotorniy',
    solveCommand: 'solve https://github.com/PeterMotorniy/auto-programmer/issues/2009',
  });
  const reason = buildForkDivergenceBlockedReason({ snapshot: unsafeSnapshot });
  const calls = [];

  const result = await notifyIssueAboutPrePullRequestFailure({
    code: 1,
    reason,
    failureActionSection,
    argv: { tool: 'codex' },
    globalState: { owner: 'PeterMotorniy', repo: 'auto-programmer', issueNumber: 2009 },
    shouldAttachLogs: true,
    getLogFile: () => '/tmp/solve.log',
    sanitizeLogContent: async value => value,
    log: async () => {},
    attachLogToGitHub: async options => {
      calls.push(options);
      return true;
    },
  });

  assert.deepEqual(result, { notified: true, method: 'log-upload' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].failureActionSection, failureActionSection);
  assert.match(calls[0].failureActionSection, /1234567890ab Alice Keep local deployment notes/);
});
