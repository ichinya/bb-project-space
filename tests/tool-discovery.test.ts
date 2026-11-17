import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverReadTools } from '../tool-discovery.ts';
test('discovery omits bulk schemas and bounds descriptions; named discovery returns one complete schema',()=>{
  const schema={type:'object',properties:{query:{type:'string',description:'large schema '.repeat(1000)}},required:['query'],additionalProperties:false};
  const first={name:'search',description:'Search\nproject '.repeat(100),inputSchema:schema},second={name:'context',description:'Context',inputSchema:{type:'object'}},write={name:'write',inputSchema:schema};
  const allowed=new Set(['search','context']),catalog=discoverReadTools({tools:[first,second,first,write]},allowed);
  assert.deepEqual(catalog.tools.map(tool=>tool.name),['search','context']);assert.doesNotMatch(JSON.stringify(catalog),/inputSchema|properties|additionalProperties/);assert.ok(JSON.stringify(catalog).length<500);assert.ok(catalog.tools[0]!.description!.length<=120);
  assert.deepEqual(discoverReadTools({tools:[first,second,write]},allowed,'search'),{tools:[first]});assert.throws(()=>discoverReadTools({tools:[first]},allowed,'context'),/недоступен/);assert.throws(()=>discoverReadTools({tools:[write]},allowed,'write'),/разрешённый/);assert.throws(()=>discoverReadTools({},allowed),/каталог/);
});
