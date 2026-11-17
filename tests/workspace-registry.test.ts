import test from 'node:test';
import assert from 'node:assert/strict';
import { registeredProject } from '../workspace-registry.ts';
const record=(path:string,group:string)=>({path,name:'Telegram',groups:[{name:group}]});
test('registry chooses the current native Windows record over historical path/case aliases',()=>{
  const old=record('d:\\Sipout\\telegram_service','integra'),legacy=record('D:\\Sipout\\telegram_service','integra'),current=record('\\\\?\\D:\\Sipout\\telegram_service','multichat');
  for(const rows of [[old,legacy,current],[current,legacy,old],[legacy,current,old]])assert.equal(registeredProject(rows,'D:\\Sipout\\telegram_service','win32'),current);
  assert.equal(registeredProject([old,legacy],'D:\\Sipout\\telegram_service','win32'),legacy);
  assert.equal(registeredProject([current],'D:/Sipout/telegram_service/','win32'),current);
  assert.equal(registeredProject([old],'D:\\Sipout\\telegram_service','win32'),old);
});
test('registry never unions groups from duplicates or folds distinct Linux paths',()=>{
  const stale=record('D:\\project','manual'),current=record('\\\\?\\D:\\project','space');assert.deepEqual(registeredProject([stale,current],'D:\\project','win32')?.groups,[{name:'space'}]);
  const upper=record('/srv/Project','upper'),lower=record('/srv/project','lower');assert.equal(registeredProject([upper,lower],'/srv/project','linux'),lower);assert.equal(registeredProject([upper,lower],'/missing','linux'),undefined);
});
