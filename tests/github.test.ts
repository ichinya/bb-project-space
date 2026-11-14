import test from 'node:test';
import assert from 'node:assert/strict';
import { githubRepositoryUrl, githubPullRequestUrl } from '../github.ts';

test('GitHub clone URLs become HTTPS repository links without credentials',()=>{
  for(const remote of ['git@github.com:owner/repo.git','ssh://git@github.com/owner/repo.git','https://token@github.com/owner/repo.git','https://github.com/owner/repo/']) {
    assert.equal(githubRepositoryUrl(remote),'https://github.com/owner/repo');
  }
});
test('missing, local, other-host and malformed repository URLs never become links',()=>{
  for(const remote of [null,undefined,'D:\\repo','git@gitlab.com:owner/repo.git','javascript:alert(1)','https://github.com.evil.test/owner/repo','https://github.com/owner/repo?token=secret','https://github.com/owner/repo/tree/main','https://github.com/owner/repo\n']) assert.equal(githubRepositoryUrl(remote),null);
});
test('PR links keep only a valid GitHub pull request target',()=>{
  assert.equal(githubPullRequestUrl('https://github.com/owner/repo/pull/42?tab=files'),'https://github.com/owner/repo/pull/42');
  for(const value of ['javascript:alert(1)','https://github.com.evil.test/owner/repo/pull/42','https://token@github.com/owner/repo/pull/42','https://github.com/owner/repo','https://github.com/owner/repo/pull/0']) assert.equal(githubPullRequestUrl(value),null);
});
