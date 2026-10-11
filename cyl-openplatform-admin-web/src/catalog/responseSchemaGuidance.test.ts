import { expect, test } from 'vitest';
import { adapterForm } from './ResponseAdapterEditor';
import { responseSchemaSuggestion } from './responseSchemaGuidance';

test('只对可定位的外壳给建议，不推测已扁平业务结构或覆盖未完成JSON',()=>{
 const form=adapterForm({mode:'ENVELOPE',successPath:'result.code',successValues:[0],dataPath:'result.data'});
 const text=JSON.stringify({type:'OBJECT',properties:{result:{type:'OBJECT',properties:{code:{type:'INTEGER'},data:{type:'STRING',nullable:true,example:null}}}},example:{result:{code:0,data:'outside'}}});
 expect(responseSchemaSuggestion(form,text)?.schema).toEqual({type:'STRING',nullable:true,example:'outside'});
 for (const input of ['{','{"type":"OBJECT","properties":{"orderId":{"type":"STRING"}}}']) expect(responseSchemaSuggestion(form,input)).toBeNull();
 expect(responseSchemaSuggestion({...form,mode:'DIRECT'},text)).toBeNull();
 expect(responseSchemaSuggestion({...form,dataPath:''},text)).toBeNull();
});
