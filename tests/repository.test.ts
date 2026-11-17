import test from 'node:test';
import assert from 'node:assert/strict';
import { gitRepository } from '../repository.ts';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';

test('GitLab links preserve subgroups, strip credentials and omit SSH ports',()=>{
  for(const remote of ['git@gitlab.com:team/subgroup/repo.git','ssh://git@gitlab.com:2222/team/subgroup/repo.git','https://user:secret@gitlab.com/team/subgroup/repo.git'])assert.deepEqual(gitRepository(remote),{provider:'gitlab',label:'GitLab',url:'https://gitlab.com/team/subgroup/repo'});
  assert.equal(gitRepository('git@gitlab.example.org:team/repo.git')?.provider,'gitlab');
});
test('GitVerse HTTPS and both SSH forms resolve to a browser repository link',()=>{
  for(const remote of ['git@gitverse.ru:owner/repo.git','ssh://git@gitverse.ru:2222/owner/repo.git','https://token@gitverse.ru/owner/repo','https://gitverse.ru/sc/owner/repo.git'])assert.deepEqual(gitRepository(remote),{provider:'gitverse',label:'GitVerse',url:'https://gitverse.ru/owner/repo'});
});
test('GitHub stays recognizable and unknown hosts use Git without impersonating another provider',()=>{
  assert.equal(gitRepository('git@github.com:owner/repo.git')?.provider,'github');
  assert.deepEqual(gitRepository('https://user:password@code.example.org:8443/team/repo.git'),{provider:'git',label:'Git',url:'https://code.example.org:8443/team/repo'});
  assert.equal(gitRepository('https://github.com.evil.test/team/repo')?.provider,'git');
  assert.equal(gitRepository('http://code.example.org/team/repo.git')?.url,'http://code.example.org/team/repo');
});
test('local paths, schemes, queries, traversal and repository subpages are rejected',()=>{
  for(const value of [null,undefined,'C:\\repo','/home/repo','file:///team/repo','javascript:team/repo','data:text/html,hello','https://gitverse.ru/owner/repo?token=secret','git@gitlab.com:team/repo#secret','https://gitlab.com/team/../repo','https://gitlab.com/team/%2e%2e/repo','https://gitlab.com/team/repo/-/tree/main','https://github.com/team/repo/tree/main','https://gitverse.ru/owner/repo\n'])assert.equal(gitRepository(value),null,value??'missing');
});
test('catalog exposes a provider-specific safe link while preserving the legacy GitHub field',async()=>{
  const {bb,harness}=createFakePluginHost({pluginId:'project-spaces',sdk:{projects:{list:async()=>[
    {id:'gl',name:'GitLab',gitRemoteUrl:'https://user:secret@gitlab.com/team/sub/repo.git',sources:[]},
    {id:'gv',name:'GitVerse',gitRemoteUrl:'git@gitverse.ru:owner/repo.git',sources:[]},
    {id:'gh',name:'GitHub',gitRemoteUrl:'git@github.com:owner/repo.git',sources:[]},
  ]},hosts:{list:async()=>[]}}});
  try{await plugin(bb);const value=await harness.behavior.callRpc('catalog',null) as {projects:{githubUrl:string|null;repository:{provider:string;url:string}}[]};assert.deepEqual(value.projects.map(p=>p.repository.provider),['gitlab','gitverse','github']);assert.equal(value.projects[0]!.githubUrl,null);assert.equal(value.projects[2]!.githubUrl,'https://github.com/owner/repo');assert.ok(!JSON.stringify(value).includes('secret'));}finally{await harness.lifecycle.dispose();}
});
