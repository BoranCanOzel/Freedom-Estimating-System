// Project definitions belong beside the company/project tree. Changes are saved
// through the estimator, so this editor uses the same collaboration path.
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node; };
let tab = 'fields', kind = 'project';

function tabs(choices, selected, change, label) {
  const nav = el('div', '', 'project-settings-tabs');
  nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', label);
  choices.forEach(([key, text]) => {
    const button = el('button', text); button.type = 'button'; button.dataset.settingsTab = key;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(key === selected));
    button.tabIndex = key === selected ? 0 : -1;
    button.onclick = () => change(key);
    button.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = choices.findIndex(c => c[0] === key);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + choices.length) % choices.length;
      change(choices[next][0]);
      document.querySelector(`[data-settings-tab="${choices[next][0]}"]`)?.focus();
    };
    nav.append(button);
  });
  return nav;
}
const action = (text, run, label = text) => {
  const button = el('button', text, 'btn alt tiny'); button.type = 'button'; button.onclick = run; button.setAttribute('aria-label', label); return button;
};
const uniqueName = (list, base) => { let name = base, n = 2; while (list.includes(name)) name = base + ' ' + n++; return name; };

export function renderProjectSettings(host) {
  const api = window.estimator.projectSettings;
  const refresh = () => { host.replaceChildren(); renderProjectSettings(host); };
  const changed = () => api.save();
  host.classList.add('project-settings-body');
  host.append(tabs([['fields', 'Custom fields'], ['statuses', 'Statuses'], ['filters', 'Filters']], tab,
    next => { tab = next; refresh(); }, 'Project settings'));
  const section = el('section', '', 'project-settings-section');
  const heading = el('h3'), hint = el('p', '', 'project-settings-hint');
  section.append(heading, hint); host.append(section);
  if (tab === 'fields') {
    heading.textContent = 'Custom details';
    hint.textContent = 'Choose where a field belongs. Renaming a field keeps its existing values.';
    section.append(tabs([['company', 'Company'], ['project', 'Project'], ['takeoff', 'Takeoff']], kind,
      next => { kind = next; refresh(); }, 'Field location'));
    const fields = api.fields(kind), rows = el('div', '', 'project-settings-rows');
    fields.forEach((field, index) => {
      const row = el('div', '', 'project-settings-row'), input = el('input');
      input.value = field; input.setAttribute('aria-label', 'Field name'); input.placeholder = 'Field name';
      input.onchange = () => {
        const name = input.value.trim();
        if (!name || ['__proto__', 'constructor', 'prototype'].includes(name) || fields.some((v, i) => i !== index && v === name)) {
          input.value = fields[index]; window.freedomSession?.notify('Use a unique, non-empty field name.'); return;
        }
        api.renameField(kind, index, name); changed();
      };
      const remove = action('×', () => { api.removeField(kind, index); changed(); refresh(); }, 'Remove field ' + field);
      remove.className = 'settings-remove'; row.append(input, remove); rows.append(row);
    });
    if (!fields.length) rows.append(el('p', 'No custom fields here yet.', 'project-settings-hint'));
    section.append(rows, action('+ Add field', () => {
      fields.push(uniqueName(fields, 'New field')); changed(); refresh();
      const inputs = host.querySelectorAll('input'); inputs[inputs.length - 1]?.focus(); inputs[inputs.length - 1]?.select();
    }));
  } else if (tab === 'statuses') {
    heading.textContent = 'Project statuses'; hint.textContent = 'Use these statuses to organize and filter projects.';
    const statuses = api.statuses();
    statuses.forEach((value, index) => {
      const row = el('div', '', 'project-settings-row'), input = el('input');
      input.value = value; input.setAttribute('aria-label', 'Status name');
      input.onchange = () => {
        const name = input.value.trim();
        if (!name || statuses.some((v, i) => i !== index && v === name)) { input.value = statuses[index]; return; }
        api.renameStatus(index, name); changed();
      };
      const remove = action('×', () => { statuses.splice(index, 1); changed(); refresh(); }, 'Remove status ' + value);
      remove.className = 'settings-remove'; remove.disabled = statuses.length === 1;
      row.append(input, remove); section.append(row);
    });
    section.append(action('+ Add status', () => { statuses.push(uniqueName(statuses, 'New status')); changed(); refresh(); }));
  } else {
    heading.textContent = 'Available filters';
    hint.textContent = 'Status is always available. Choose which project details appear in the Filter menu.';
    const fields = api.fields('project');
    fields.forEach(field => {
      const label = el('label', '', 'settings-filter-choice'), checkbox = el('input');
      checkbox.type = 'checkbox'; checkbox.checked = api.filters().includes(field);
      checkbox.onchange = () => { api.setFilter(field, checkbox.checked); changed(); };
      label.append(checkbox, document.createTextNode(field)); section.append(label);
    });
    if (!fields.length) section.append(action('Add project fields', () => { tab = 'fields'; kind = 'project'; refresh(); }));
  }
}
