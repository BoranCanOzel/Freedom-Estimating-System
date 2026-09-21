import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { readBook, writeBook, validateBook } from '../shared/model.js';

const seed = { lists: [{ id: 'list', companies: [] }], sheets: [{ id: 'sheet', rows: [{ id: 'a', name: 'Saw', count: 1, cost: 10 }, { id: 'b', name: 'Truck', count: 2 }] }] };
function replicas() {
  const a = new Y.Doc(), b = new Y.Doc(); writeBook(a, {}, seed); Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); return [a,b];
}
function exchange(a,b) { const aa = Y.encodeStateAsUpdate(a), bb = Y.encodeStateAsUpdate(b); Y.applyUpdate(a, bb); Y.applyUpdate(b, aa); assert.deepEqual(readBook(a), readBook(b)); }
test('round-trips a workbook, preserving numbers, empty arrays, and text', () => {
  const [a] = replicas(); assert.deepEqual(readBook(a), seed);
});
test('simultaneous changes to different fields survive', () => {
  const [a,b] = replicas(), av = readBook(a), bv = readBook(b), aa = structuredClone(av), bb = structuredClone(bv);
  aa.sheets[0].rows[0].count = 7; bb.sheets[0].rows[0].cost = 99;
  writeBook(a,av,aa); writeBook(b,bv,bb); exchange(a,b);
  assert.equal(readBook(a).sheets[0].rows[0].count,7); assert.equal(readBook(a).sheets[0].rows[0].cost,99);
});
test('concurrent text insertions merge and converge', () => {
  const [a,b] = replicas(), av = readBook(a), bv = readBook(b), aa = structuredClone(av), bb = structuredClone(bv);
  aa.sheets[0].rows[0].name += ' A'; bb.sheets[0].rows[0].name += ' B';
  writeBook(a,av,aa); writeBook(b,bv,bb); exchange(a,b);
  assert.match(readBook(a).sheets[0].rows[0].name,/A/); assert.match(readBook(a).sheets[0].rows[0].name,/B/);
});
test('numeric input strings resolve to one value rather than combining digits', () => {
  const [a,b] = replicas(), av = readBook(a), bv = readBook(b), aa = structuredClone(av), bb = structuredClone(bv);
  aa.sheets[0].rows[0].count = '10'; bb.sheets[0].rows[0].count = '20';
  writeBook(a,av,aa); writeBook(b,bv,bb); exchange(a,b);
  assert.ok(['10','20'].includes(readBook(a).sheets[0].rows[0].count));
});
test('concurrent additions and a row move do not lose records or edits', () => {
  const [a,b] = replicas(), av = readBook(a), bv = readBook(b), aa = structuredClone(av), bb = structuredClone(bv);
  aa.sheets[0].rows.reverse(); aa.sheets[0].rows.push({id:'c',name:'Third'});
  bb.sheets[0].rows[0].cost = 200; bb.sheets[0].rows.push({id:'d',name:'Fourth'});
  writeBook(a,av,aa); writeBook(b,bv,bb); exchange(a,b);
  const rows = readBook(a).sheets[0].rows;
  assert.deepEqual(rows.map(r=>r.id).sort(),['a','b','c','d']); assert.equal(rows.find(r=>r.id==='a').cost,200);
});
test('deleting a row while another client edits it does not resurrect it', () => {
  const [a,b] = replicas(), av = readBook(a), bv = readBook(b), aa = structuredClone(av), bb = structuredClone(bv);
  aa.sheets[0].rows.shift(); bb.sheets[0].rows[0].cost = 999;
  writeBook(a,av,aa); writeBook(b,bv,bb); exchange(a,b);
  assert.deepEqual(readBook(a).sheets[0].rows.map(r=>r.id),['b']);
});
test('rejects unrelated JSON and prototype keys', () => {
  assert.throws(()=>validateBook({hello:'world'}));
  assert.throws(()=>validateBook(JSON.parse('{"sheets":[],"__proto__":{}}')));
});

test('every five-row reorder round-trips without splitting moved blocks', () => {
  const permutations = ids => ids.length ? ids.flatMap((id,i) =>
    permutations(ids.filter((_,j) => j !== i)).map(rest => [id,...rest])) : [[]];
  const initial = {sheets:[{id:'s',rows:['a','b','c','d','e'].map(id => ({id,name:id}))}]};
  for (const ids of permutations(['a','b','c','d','e'])) {
    const doc = new Y.Doc();
    writeBook(doc,{},initial);
    const next = structuredClone(initial);
    next.sheets[0].rows = ids.map(id => initial.sheets[0].rows.find(row => row.id === id));
    writeBook(doc,initial,next);
    assert.deepEqual(readBook(doc),next,ids.join(','));
    const edited = structuredClone(next);
    edited.sheets[0].rows[2].name = 'Edited name';
    edited.sheets[0].rows[2].cost = 125;
    writeBook(doc,next,edited);
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened,Y.encodeStateAsUpdate(doc));
    assert.deepEqual(readBook(reopened),edited);
    doc.destroy(); reopened.destroy();
  }
});

test('nested section moves survive later edits, remote updates, undo and redo', () => {
  const original = {sheets:[{id:'s',rows:[
    {id:'p',type:'section',name:'Parent'},
    {id:'a',name:'First line',cost:10},
    {id:'c',type:'section',name:'Child'},
    {id:'w',name:'Nested work',cost:20},
    {id:'ce',type:'sectionEnd',sid:'c'},
    {id:'pe',type:'sectionEnd',sid:'p'}
  ]}]};
  const a=new Y.Doc(), b=new Y.Doc();
  writeBook(a,{},original,'seed'); Y.applyUpdate(b,Y.encodeStateAsUpdate(a),'remote');
  const history = new Y.UndoManager(a,{trackedOrigins:new Set(['local'])});
  const moved=structuredClone(original);
  moved.sheets[0].rows=['p','c','w','ce','a','pe'].map(id=>moved.sheets[0].rows.find(row=>row.id===id));
  writeBook(a,original,moved);
  const edited=structuredClone(original); edited.sheets[0].rows[3].cost=99;
  writeBook(b,original,edited); exchange(a,b);
  assert.deepEqual(readBook(a).sheets[0].rows.map(r=>r.id),['p','c','w','ce','a','pe']);
  assert.equal(readBook(a).sheets[0].rows.find(r=>r.id==='w').cost,99);
  history.undo();
  assert.deepEqual(readBook(a).sheets[0].rows.map(r=>r.id),original.sheets[0].rows.map(r=>r.id));
  assert.equal(readBook(a).sheets[0].rows.find(r=>r.id==='w').cost,99);
  history.redo();
  assert.deepEqual(readBook(a).sheets[0].rows.map(r=>r.id),['p','c','w','ce','a','pe']);
  a.destroy(); b.destroy();
});
