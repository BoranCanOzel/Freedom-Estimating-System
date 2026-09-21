import { renderProjectSettings } from './project-settings.js';
import './workspace.css';
import './textures.css';

const $ = id => document.getElementById(id);

export function setupWorkspace() {
  const bridge = window.estimator;
  window.freedomWorkspace = { renderProjectSettings };
  try { const preferences = JSON.parse(localStorage.getItem('freedom:appearance')); if (preferences) bridge.setAppearance(preferences); } catch {}
  const rememberAppearance = () => { try { localStorage.setItem('freedom:appearance', JSON.stringify(bridge.getAppearance())); } catch {} };
  $('workspace-menus').innerHTML = `
    <details class="workspace-menu" id="workspace-file">
      <summary>File</summary><div class="workspace-menu-content">
        <p class="menu-label">Workbook</p>
        <button id="server-import" type="button">Import JSON…</button>
        <button id="server-export" type="button" data-ready disabled>Export JSON</button>
        <div class="menu-divider"></div><p class="menu-label">Reports</p>
        <div id="workspace-excel"></div>
        <button id="workspace-print" type="button" data-ready>Print current view</button>
        <button id="workspace-print-all" type="button" data-ready>Print all options</button>
        <div class="menu-divider"></div><p class="menu-label">Directories · Excel</p>
        <button id="workspace-export-companies" type="button" data-ready>Export company list</button>
        <button id="workspace-export-projects" type="button" data-ready>Export project list</button>
      </div>
    </details>
    <details class="workspace-menu" id="workspace-view">
      <summary>View</summary><div class="workspace-menu-content">
        <p class="menu-label">Appearance · just for you</p>
        <div class="workspace-themes" role="group" aria-label="Theme">
          <button id="lightMode" type="button" data-theme="light">Light</button>
          <button id="darkMode" type="button" data-theme="dark">Dark</button>
          <button id="medievalMode" type="button" data-theme="medieval">Medieval</button>
        </div>
        <div id="workspace-zoom"></div>
        <div class="workspace-cursor-setting"><label for="workspace-cursor">Cursor style</label>
          <select id="workspace-cursor" disabled>
            <option value="system">System default</option><option value="large-dark">Large dark arrow</option>
            <option value="large-light">Large light arrow</option><option value="crosshair">Crosshair</option>
          </select>
        </div><p class="workspace-preference-hint">Saved to your account.</p>
        <div data-for-view="sheet" class="menu-context"><div class="menu-divider"></div>
          <p class="menu-label">Sheet display</p><div id="workspace-pictures"></div><div id="workspace-detail"></div>
        </div>
        <div data-for-view="summary" class="menu-context"><div class="menu-divider"></div>
          <p class="menu-label">Summary display</p><div id="workspace-summary"></div>
        </div>
        <div data-for-view="load" class="menu-context"><div class="menu-divider"></div>
          <p class="menu-label">Load calculator</p><div id="workspace-load"></div>
        </div>
      </div>
    </details>
    <details class="workspace-menu" id="workspace-estimate" data-for-view="sheet">
      <summary>Estimate</summary><div class="workspace-menu-content">
        <p class="menu-label">Current option</p><div id="workspace-rounding"></div><div id="workspace-load-toggle"></div>
        <div class="menu-divider"></div><p class="menu-label">Restore hidden columns</p><div id="workspace-columns"></div>
        <div class="menu-divider"></div><p class="menu-label">Manage option</p><div id="workspace-option-actions"></div>
      </div>
    </details>`;

  // Reparent live controls: preserve listeners, IDs, and their existing behavior.
  const move = (id, host, parent = false) => $(host).append(parent ? $(id).parentElement : $(id));
  move('zoomPick', 'workspace-zoom', true);
  $('zoomPick').previousElementSibling.textContent = 'Zoom';
  move('roundTotal', 'workspace-rounding', true);
  $('workspace-pictures').append($('showPics').closest('.pic-pair'));
  $('workspace-pictures').querySelector('.pic-lab').textContent = 'Pictures';
  move('toggleNotes', 'workspace-detail');
  const detailCopy = document.createElement('button');
  detailCopy.id = 'workspace-toggle-notes'; detailCopy.type = 'button';
  detailCopy.textContent = $('toggleNotes').textContent; detailCopy.hidden = $('toggleNotes').hidden;
  detailCopy.onclick = () => $('toggleNotes').click();
  document.querySelector('#sheetCard .eyebrow-row').append(detailCopy);
  move('sumSections', 'workspace-summary'); move('sumDetail', 'workspace-summary');
  move('loadFoldAll', 'workspace-load'); move('sheetLoadBtn', 'workspace-load-toggle');
  move('hiddenCols', 'workspace-columns');
  const pageActions = document.createElement('div');
  pageActions.id = 'workspace-page-actions';
  pageActions.dataset.forView = 'sheet';
  pageActions.setAttribute('role', 'group');
  pageActions.setAttribute('aria-label', 'Current page actions');
  $('workspace-menus').after(pageActions);
  move('duplicateSheet', 'workspace-page-actions');
  move('deleteSheet', 'workspace-page-actions');
  move('reset', 'workspace-option-actions');
  const excel = document.querySelector('.js-export');
  excel.textContent = 'Export estimate to Excel'; excel.dataset.ready = ''; $('workspace-excel').append(excel);
  // Duplicate footer controls remain available to legacy event handlers, but do
  // not create another user-facing entry point.
  const parking = document.createElement('div'); parking.id = 'workspace-legacy'; parking.hidden = true;
  document.body.append(parking);
  for (const control of document.querySelectorAll('.card > .bar .js-export, .card > .bar .js-print, #saveFile, #saveFile2, #loadFile, #loadFile2')) parking.append(control);
  const itemActions = document.querySelector('#sheetTable .h-adds');
  parking.append($('hAddItem'), $('hAddSec'));
  itemActions.append($('add'), $('addSection'));
  for (const bar of document.querySelectorAll('.card > .bar')) {
    bar.querySelectorAll('.legend').forEach(legend => { bar.title = legend.textContent; legend.remove(); });
    if (!bar.children.length) { bar.remove(); continue; }
    bar.classList.add('workspace-actions');
    bar.parentElement.querySelector(':scope > .head').append(bar);
  }
  $('add').textContent = '+ Item'; $('addSection').textContent = '+ Section';

  $('server-hierarchy').append($('projects'));
  $('projects').setAttribute('aria-label', 'Companies, projects and takeoffs');
  $('projToggle').hidden = true; $('projClose').hidden = true;
  $('projOptions').textContent = 'Project settings';
  $('projOptions').title = 'Custom fields, statuses and filters for this workbook';
  $('projToggle').addEventListener('click', event => { event.stopImmediatePropagation(); $('server-projects').click(); }, true);
  document.body.classList.remove('proj-open');
  document.body.classList.add('workspace-projects-open');

  const closeMenus = (except = null) => document.querySelectorAll('.workspace-menu[open]').forEach(menu => { if (menu !== except) menu.open = false; });
  function fit(menu) {
    const content = menu.querySelector('.workspace-menu-content'); if (!content) return;
    content.style.left = '0px';
    const rect = content.getBoundingClientRect(), zoom = parseFloat(getComputedStyle(document.body).zoom) || 1;
    if (rect.right > innerWidth - 12) content.style.left = (innerWidth - 12 - rect.right) / zoom + 'px';
  }
  for (const menu of document.querySelectorAll('.workspace-menu')) {
    const summary = menu.querySelector('summary');
    menu.addEventListener('toggle', () => {
      summary.setAttribute('aria-expanded', String(menu.open));
      if (menu.open) { closeMenus(menu); fit(menu); }
    });
    summary.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') {
        event.preventDefault(); menu.open = true;
        menu.querySelector('button:not(:disabled), select:not(:disabled)')?.focus();
      }
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); menu.open = false; summary.focus(); }
    });
  }
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.workspace-menu')) closeMenus(); });
  document.addEventListener('focusin', event => { if (!event.target.closest('.workspace-menu')) closeMenus(); });
  window.addEventListener('resize', () => document.querySelectorAll('.workspace-menu[open]').forEach(fit));
  $('workspace-file').addEventListener('click', event => { if (event.target.closest('button')) closeMenus(); });
  $('workspace-print').onclick = () => { closeMenus(); bridge.print(false); };
  $('workspace-print-all').onclick = () => { closeMenus(); bridge.print(true); };
  $('workspace-export-companies').onclick = () => bridge.exportCompanies();
  $('workspace-export-projects').onclick = () => bridge.exportProjects();
  document.querySelectorAll('[data-theme]').forEach(button => {
    button.onclick = () => { bridge.setTheme(button.dataset.theme); rememberAppearance(); sync(); };
  });
  $('zoomPick').addEventListener('change', rememberAppearance);
  function sync() {
    const ready = document.body.classList.contains('server-active'), view = bridge.getLocation().view || 'sheet';
    document.body.dataset.workspaceView = view;
    for (const part of document.querySelectorAll('[data-for-view]')) {
      part.hidden = !ready || part.dataset.forView !== view;
      if (part.hidden && part.tagName === 'DETAILS') part.open = false;
    }
    for (const button of document.querySelectorAll('[data-ready]')) button.disabled = !ready;
    for (const button of document.querySelectorAll('[data-theme]')) button.setAttribute('aria-pressed', String(button.dataset.theme === bridge.themeName()));
  }
  document.addEventListener('estimator:view', sync);
  sync();
  function setCursor(style) {
    if (!['system','large-dark','large-light','crosshair'].includes(style)) style = 'system';
    document.body.dataset.cursor = style;
    $('workspace-cursor').value = style;
    if (style.startsWith('large-')) {
      const light = style === 'large-light';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M3 2 L3 26 L10 19 L15 30 L20 28 L15 17 L25 17 Z" fill="${light ? '#fff' : '#141414'}" stroke="${light ? '#141414' : '#fff'}" stroke-width="2" stroke-linejoin="round"/></svg>`;
      document.body.style.setProperty('--workspace-cursor', `url("data:image/svg+xml,${encodeURIComponent(svg)}") 3 2, default`);
    } else document.body.style.setProperty('--workspace-cursor', style === 'crosshair' ? 'crosshair' : 'auto');
  }
  return { sync, closeMenus, setCursor };
}
