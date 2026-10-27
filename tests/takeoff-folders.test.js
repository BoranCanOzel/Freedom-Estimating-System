import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {validateTakeoff} from '../shared/ai-takeoff.js';
import {readBook,writeBook} from '../shared/model.js';
import {importTransfer,exportTransfer,transferChoices} from '../shared/transfers.js';
import {resolveLocation} from '../shared/navigation.js';

const takeoff=()=>({id:'t',name:'Estimate',folders:[{id:'f',name:'Building A'}],sheets:[{id:'s',folderId:'f',rows:[{id:'r',kind:'labor',cost:100}]}]});
test('page locations resolve their current folder and empty folders do not jump to another page',()=>{
  const tk=takeoff();tk.folders.push({id:'empty',name:'Empty folder'});
  const book={lists:[{id:'l',companies:[{id:'c',projects:[{id:'p',takeoffs:[tk]}]}]}]};
  assert.equal(resolveLocation(book,{takeoff:'t',sheet:'s',view:'sheet'}).tab,'Building A / Tab 1');
  const empty=resolveLocation(book,{takeoff:'t',folder:'empty',view:'sheet'});
  assert.equal(empty.folder,'empty');assert.equal(empty.sheet,'');assert.equal(empty.tab,'Empty folder');
});
test('folder validation accepts legacy pages and rejects invalid membership and malformed folders',()=>{
  const before=takeoff();assert.equal(validateTakeoff(before,before),before);
  const legacy={id:'t',name:'Estimate',sheets:[{id:'s',rows:[]}]};validateTakeoff(legacy,legacy);
  for(const folders of [null,{},[null],[{name:'No ID'}],[{id:'f',name:''}],[{id:'f',name:4}],[{id:'f',name:'A'},{id:'f',name:'B'}]]){
    const next=takeoff();next.folders=folders;assert.throws(()=>validateTakeoff(next,before));
  }
  for(const folderId of ['missing',null,42]){
    const next=takeoff();next.sheets[0].folderId=folderId;assert.throws(()=>validateTakeoff(next,before),/folderId/);
  }
  const next=takeoff();next.folders=[];delete next.sheets[0].folderId;validateTakeoff(next,before);
  assert.deepEqual(next.sheets[0].rows,before.sheets[0].rows);
});

test('takeoff transfers renew folder references while retaining all pages and pricing',()=>{
  const record=takeoff(),book={lists:[{id:'l',companies:[{id:'c',projects:[{id:'p',takeoffs:[record]}]}]}]};
  const exported=exportTransfer(book,'takeoff',record);
  const copy=importTransfer(book,'takeoff',transferChoices(exported,'takeoff')[0].data,'p').lists[0].companies[0].projects[0].takeoffs[1];
  assert.notEqual(copy.folders[0].id,record.folders[0].id);
  assert.equal(copy.sheets[0].folderId,copy.folders[0].id);
  assert.equal(copy.sheets[0].rows[0].cost,100);
});

test('collaborators can rename folders and move pages without losing either change',()=>{
  const before={sheets:[takeoff()]},a=new Y.Doc(),b=new Y.Doc();writeBook(a,{},before);Y.applyUpdate(b,Y.encodeStateAsUpdate(a));
  const left=structuredClone(before),right=structuredClone(before);
  left.sheets[0].folders[0].name='East building';right.sheets[0].sheets[0].folderId='';
  writeBook(a,before,left);writeBook(b,before,right);
  const ua=Y.encodeStateAsUpdate(a),ub=Y.encodeStateAsUpdate(b);Y.applyUpdate(a,ub);Y.applyUpdate(b,ua);
  assert.deepEqual(readBook(a),readBook(b));
  assert.equal(readBook(a).sheets[0].folders[0].name,'East building');
  assert.equal(readBook(a).sheets[0].sheets[0].folderId,'');
});
