import test from 'node:test';
import assert from 'node:assert/strict';
import {publicUrl} from '../client/public-url.js';
test('published share links use HTTPS and retain access fragments',()=>{
  assert.equal(publicUrl('/share#secret','http://est.freedomcc.us'),'https://est.freedomcc.us/share#secret');
  assert.equal(publicUrl('/share#secret','https://est.freedomcc.us'),'https://est.freedomcc.us/share#secret');
});
test('AI endpoints and website origin use HTTPS',()=>{
  const origin=new URL(publicUrl('/','http://est.freedomcc.us')).origin;
  assert.equal(origin,'https://est.freedomcc.us');
  for(const path of ['/api/ai/v1','/api/ai/v1/mcp','/api/ai/v1/openapi.json','/api/ai/v1/instructions','/api/ai/v1/takeoff','/api/ai/v1/validate','/api/ai/v1/save'])assert.equal(publicUrl(path,origin),'https://est.freedomcc.us'+path);
});
test('local development links retain their protocol and port',()=>{
  for(const origin of ['http://localhost:3100','http://127.0.0.1:3100','http://[::1]:3100'])assert.equal(publicUrl('/share#key',origin),origin+'/share#key');
});
