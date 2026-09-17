// Resolve IDs against the current workbook so renamed/deleted records stay accurate.
export function resolveLocation(book, location = {}) {
  for (const list of book.lists || []) for (const company of list.companies || []) {
    for (const project of company.projects || []) {
      const takeoff = (project.takeoffs || []).find(t => t.id === location.takeoff);
      if (!takeoff || (location.list && location.list !== list.id)) continue;
      const sheet = (takeoff.sheets || []).find(s => s.id === location.sheet) || takeoff.sheets?.[0];
      const view = ['sheet','summary','scopes','load','wage'].includes(location.view) ? location.view : 'sheet';
      const tab = view === 'sheet' ? 'Tab ' + (sheet?.num || (takeoff.sheets || []).indexOf(sheet) + 1)
        : {summary:'Summary',scopes:'Scopes',load:'Load calc',wage:'Wage calc'}[view];
      return {list:list.id,company:company.id,project:project.id,takeoff:takeoff.id,sheet:sheet?.id || '',view,tab,
        listName:list.name || 'Projects',companyName:company.name || 'Untitled customer',
        projectName:project.name || 'Untitled project',takeoffName:takeoff.name || 'Untitled takeoff'};
    }
  }
  return null;
}
