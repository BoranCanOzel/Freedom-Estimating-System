// Workbook history uses Yjs so another estimator's edits are not rolled back.
// Unsaved editor drafts have their own history until Save commits them.
export function setupHistory(bridge, connection) {
  const undo = document.getElementById('workspace-undo');
  const redo = document.getElementById('workspace-redo');
  let draft = null, past = [], future = [], lastInput = null, lastTime = 0;
  let pendingEvent = null, pendingTimer;
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  function syncDraft() {
    const next = bridge.getEditorHistory();
    if (next?.session !== draft?.session || !next) { past=[]; future=[]; lastInput=null; }
    draft = next;
  }
  function paint() {
    const live = connection();
    const editing = bridge.getEditorHistory();
    undo.disabled = editing ? !past.length : !live?.ready || live.closed || !live.history.canUndo();
    redo.disabled = editing ? !future.length : !live?.ready || live.closed || !live.history.canRedo();
  }
  function before(event) {
    flush();
    if (event.type !== 'beforeinput') { connection()?.history.stopCapturing(); lastInput=null; }
    syncDraft();
  }
  function after(event) {
    // A new task runs after every handler, even when a button stops propagation.
    pendingEvent = event;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(flush, 0);
  }
  function flush() {
    if (!pendingEvent) return;
    const event = pendingEvent; pendingEvent = null; clearTimeout(pendingTimer);
    const next = bridge.getEditorHistory();
    if (next && draft?.session === next.session && !equal(next.value,draft.value)) {
      const typing = event.type === 'input' && event.target === lastInput && Date.now()-lastTime < 500;
      if (!typing) past.push(draft);
      future=[]; lastInput=event.type === 'input' ? event.target : null; lastTime=Date.now();
    } else if (next?.session !== draft?.session) { past=[]; future=[]; lastInput=null; }
    draft=next; paint();
  }
  function travel(isRedo) {
    flush();
    if (document.querySelector('#body.sorting')) window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
    const current = bridge.getEditorHistory();
    if (current) {
      if (current.session !== draft?.session) syncDraft();
      const from = isRedo ? future : past, to = isRedo ? past : future;
      if (!from.length) return;
      to.push(current);
      draft=from.pop(); lastInput=null;
      const active=document.activeElement, controls=[...document.querySelectorAll('#editor input,#editor textarea,#editor select')];
      const index=controls.indexOf(active), start=active?.selectionStart;
      bridge.restoreEditorHistory(draft);
      const restored=document.querySelectorAll('#editor input,#editor textarea,#editor select')[index];
      if (restored) { restored.focus({preventScroll:true}); try { restored.setSelectionRange(start,start); } catch {} }
    } else connection()?.travelHistory(isRedo);
    paint();
  }
  function nativeField(target) {
    return target instanceof Element && !!target.closest('dialog, .folder-rename-form, #folderNew, #catFolderNew, #projSearch, #libSearch, #server-search, [contenteditable=true]');
  }
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
    const key=event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    if (!connection()?.ready || nativeField(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    travel(key === 'y' || event.shiftKey);
  }, true);
  document.addEventListener('beforeinput', event => {
    if (['historyUndo','historyRedo'].includes(event.inputType) && connection()?.ready && !nativeField(event.target)) {
      event.preventDefault(); travel(event.inputType === 'historyRedo');
    }
  }, true);
  for (const type of ['pointerdown','focusin','beforeinput']) document.addEventListener(type,before,true);
  for (const type of ['click','input','change','pointerup','keydown']) document.addEventListener(type,after,true);
  document.addEventListener('estimator:history',paint);
  document.addEventListener('estimator:editor-render',after);
  document.addEventListener('estimator:before-receive',flush);
  document.addEventListener('estimator:editor-rebase', event => {
    const {before,after}=event.detail;
    if (before && after && before.session === after.session && draft?.session === before.session) {
      const rebase=snapshot=>bridge.rebaseEditorHistory(snapshot,before,after);
      past=past.map(rebase); future=future.map(rebase); draft=after;
    } else syncDraft();
    paint();
  });
  undo.addEventListener('click',()=>travel(false));
  redo.addEventListener('click',()=>travel(true));
  paint();
}
