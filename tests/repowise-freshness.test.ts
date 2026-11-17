import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { checkoutFingerprint } from '../repowise-freshness.ts';
const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,windowsHide:true,stdio:'pipe'});
async function fixture(run:(root:string)=>Promise<void>){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-freshness-'));try{await run(root);}finally{assert.ok(root.startsWith(os.tmpdir()+path.sep));await fs.rm(root,{recursive:true,force:true});}}

test('freshness detects HEAD, repeated dirty edits, staged rename and untracked files; ignores generated indexes',async()=>fixture(async root=>{
  git(root,'init','--quiet');await fs.writeFile(path.join(root,'code.ts'),'export const value=1;');git(root,'add','.');git(root,'-c','user.name=QA','-c','user.email=qa@example.invalid','commit','--quiet','-m','fixture');
  const clean=await checkoutFingerprint(root);assert.ok(clean);assert.equal(await checkoutFingerprint(root),clean);
  for(const name of ['.repowise','.bb','node_modules']){await fs.mkdir(path.join(root,name));await fs.writeFile(path.join(root,name,'generated'),'content');}
  assert.equal(await checkoutFingerprint(root),clean);
  await fs.writeFile(path.join(root,'code.ts'),'export const value=2;');const dirty=await checkoutFingerprint(root);assert.ok(dirty);assert.notEqual(dirty,clean);
  await fs.writeFile(path.join(root,'code.ts'),'export const value=3;');await fs.utimes(path.join(root,'code.ts'),new Date(),new Date(Date.now()+2000));assert.notEqual(await checkoutFingerprint(root),dirty);
  git(root,'add','code.ts');git(root,'-c','user.name=QA','-c','user.email=qa@example.invalid','commit','--quiet','-m','update');const committed=await checkoutFingerprint(root);assert.notEqual(committed,clean);
  git(root,'mv','code.ts','renamed file.ts');assert.ok(await checkoutFingerprint(root));assert.notEqual(await checkoutFingerprint(root),committed);
  const renamed=await checkoutFingerprint(root);await fs.writeFile(path.join(root,'new file.ts'),'new');assert.notEqual(await checkoutFingerprint(root),renamed);
}));

test('Git worktree fingerprints use their own checkout and plain folders remain bounded',async()=>fixture(async root=>{
  const main=path.join(root,'main'),worktree=path.join(root,'worktree'),plain=path.join(root,'plain');await fs.mkdir(main);git(main,'init','--quiet');await fs.writeFile(path.join(main,'code.ts'),'one');git(main,'add','.');git(main,'-c','user.name=QA','-c','user.email=qa@example.invalid','commit','--quiet','-m','fixture');git(main,'worktree','add','--quiet','--detach',worktree);
  const before=await checkoutFingerprint(main);assert.equal(await checkoutFingerprint(worktree),before);await fs.writeFile(path.join(worktree,'code.ts'),'two');assert.equal(await checkoutFingerprint(main),before);assert.notEqual(await checkoutFingerprint(worktree),before);
  await fs.mkdir(plain);await fs.writeFile(path.join(plain,'helper.py'),'one');const initial=await checkoutFingerprint(plain);assert.ok(initial);await fs.mkdir(path.join(plain,'.repowise'));await fs.writeFile(path.join(plain,'.repowise','state.json'),'{}');assert.equal(await checkoutFingerprint(plain),initial);await fs.writeFile(path.join(plain,'helper.py'),'two');assert.notEqual(await checkoutFingerprint(plain),initial);
  assert.equal(await checkoutFingerprint(path.join(root,'missing')),null);
}));
