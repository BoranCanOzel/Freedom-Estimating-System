import * as Y from 'yjs';

const key = path => JSON.stringify(path);

// Stable item IDs keep an edit attached to its row when another user reorders it.
// Non-keyed arrays (e.g. lists of flags) are atomic values. Text is a Y.Text;
// scalar fields use Y.Map's deterministic conflict resolution.
const equal = (a, b) => {
  if (Object.is(a,b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
};
const childPath = (path,segment) => path==='[]'?'['+JSON.stringify(segment)+']':path.slice(0,-1)+','+JSON.stringify(segment)+']';
const safeKey = k => !['__proto__', 'constructor', 'prototype'].includes(k);
const textFields = new Set(['name', 'title', 'note', 'notes', 'text', 'summaryNotes', 'label', 'description', 'address']);

function flatten(value, path = '[]', last = null, out = new Map()) {
  const k = path;
  if (Array.isArray(value)) {
    const ids = [], seen = new Set();let keyed = true;
    for (const item of value) {
      const id=item&&typeof item==='object'&&typeof item.id==='string'?item.id:null;
      if(!id||seen.has(id)){keyed=false;break;}
      ids.push(id);seen.add(id);
    }
    if (keyed) {
      out.set(k, { kind: 'array', ids });
      for(const item of value)flatten(item,childPath(k,'@'+item.id),'@'+item.id,out);
    } else out.set(k, { kind: 'value', value });
  } else if (value && typeof value === 'object') {
    out.set(k, { kind: 'object' });
    for(const p of Object.keys(value))if(safeKey(p))flatten(value[p],childPath(path,p),p,out);
  } else if (typeof value === 'string' && textFields.has(last)) out.set(k, { kind: 'text', value });
  else out.set(k, { kind: 'value', value: value ?? null });
  return out;
}

function changeText(text, previous, next) {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let end = 0;
  while (end < previous.length - start && end < next.length - start && previous.at(-end - 1) === next.at(-end - 1)) end++;
  const remove = previous.length - start - end;
  if (remove) text.delete(start, remove);
  const insert = next.slice(start, next.length - end);
  if (insert) text.insert(start, insert);
}

function changeOrder(order, previous, next) {
  // Only remove members this client knew about. Concurrent additions survive.
  const nextIds = new Set(next);
  const removed = new Set(previous.filter(id => !nextIds.has(id)));
  for (let i = order.length - 1; i >= 0; i--) if (removed.has(order.get(i))) order.delete(i, 1);
  // Keep a longest unchanged subsequence in place. Comparing only each row's
  // old predecessor misses the rest of a moved block and splits nested sections.
  // Compute this against the client's baseline, not the merged remote order,
  // so an unrelated local edit does not undo a collaborator's reorder.
  const positions = new Map(previous.map((id,i) => [id,i]));
  const sequence = next.filter(id => positions.has(id));
  const tails = [], parents = [];
  sequence.forEach((id,i) => {
    let low = 0, high = tails.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (positions.get(sequence[tails[mid]]) < positions.get(id)) low = mid + 1;
      else high = mid;
    }
    parents[i] = low ? tails[low - 1] : -1;
    tails[low] = i;
  });
  const stationary = new Set();
  for (let i = tails.at(-1); i != null && i >= 0; i = parents[i]) stationary.add(sequence[i]);
  const present = new Set(order.toArray());
  next.forEach((id, i) => {
    if (stationary.has(id) && present.has(id)) return;
    for (let j = order.length - 1; j >= 0; j--) if (order.get(j) === id) order.delete(j, 1);
    present.delete(id);
    const current = order.toArray();
    let before = -1;
    for (let j = i - 1; j >= 0 && before < 0; j--) before = current.lastIndexOf(next[j]);
    order.insert(before + 1, [id]);
    present.add(id);
  });
}

export function writeBook(doc, previous, next, origin = 'local') {
  const before = flatten(previous), after = flatten(next), fields = doc.getMap('fields');
  doc.transact(() => {
    for (const k of before.keys()) if (!after.has(k)) fields.delete(k);
    for (const [k, value] of after) {
      const old = before.get(k);
      if (equal(old, value) && fields.has(k)) continue;
      if (value.kind === 'text') {
        const current = fields.get(k);
        if (current instanceof Y.Text) changeText(current, current.toString(), value.value);
        else { const text = new Y.Text(); text.insert(0, value.value); fields.set(k, text); }
      } else {
        const marker = value.kind === 'array' ? { kind: 'array' } : value;
        if (!equal(fields.get(k), marker)) fields.set(k, marker);
        if (value.kind === 'array') changeOrder(doc.getArray('order:' + k), old?.ids || [], value.ids);
      }
    }
  }, origin);
}

export function readBook(doc) {
  const fields = doc.getMap('fields'), children = new Map();
  for (const k of fields.keys()) {
    const path = JSON.parse(k);
    if (!path.length) continue;
    const parent = key(path.slice(0, -1));
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(path.at(-1));
  }
  function read(path) {
    const k = key(path), entry = fields.get(k);
    if (entry instanceof Y.Text) return entry.toString();
    if (!entry) return undefined;
    if (entry.kind === 'value') return structuredClone(entry.value);
    if (entry.kind === 'array') {
      const order = doc.getArray('order:' + k).toArray();
      // Concurrent moves may leave duplicate IDs; the last occurrence wins.
      return order.filter((id, i) => order.lastIndexOf(id) === i && fields.has(key([...path, '@' + id])))
        .map(id => read([...path, '@' + id]));
    }
    const result = {};
    for (const p of children.get(k) || []) if (safeKey(p)) result[p] = read([...path, p]);
    return result;
  }
  return read([]) || {};
}

export function validateBook(book) {
  if (!book || typeof book !== 'object' || Array.isArray(book)) throw new Error('Choose a project-breakdown JSON file.');
  if (!Array.isArray(book.lists) && !Array.isArray(book.companies) && !Array.isArray(book.sheets) && !Array.isArray(book.rows)) {
    throw new Error('This JSON file does not contain an estimating workbook.');
  }
  let nodes = 0;
  function visit(v, depth) {
    if (++nodes > 250000 || depth > 50) throw new Error('Workbook is too large or too deeply nested.');
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      if (!safeKey(k)) throw new Error('Workbook contains an invalid property.');
      visit(x, depth + 1);
    }
  }
  visit(book, 0);
  return book;
}
