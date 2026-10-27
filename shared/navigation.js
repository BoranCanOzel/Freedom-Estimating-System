// Resolve IDs against the current workbook so renamed/deleted records stay accurate.
export function resolveLocation(book, location = {}) {
  for (const list of book.lists || []) for (const company of list.companies || []) {
    for (const project of company.projects || []) {
      const takeoff = (project.takeoffs || []).find(t => t.id === location.takeoff);
      if (!takeoff || (location.list && location.list !== list.id)) continue;
      const folders=takeoff.folders||[];
      const requestedFolder=folders.find(f=>f.id===location.folder);
      const sheet = (takeoff.sheets || []).find(s => s.id === location.sheet)
        || (requestedFolder ? takeoff.sheets?.find(s=>s.folderId===requestedFolder.id) : takeoff.sheets?.[0]);
      const folder=folders.find(f=>f.id===sheet?.folderId)||requestedFolder;
      const view = location.view === 'scopes' ? 'scope' : ['sheet','summary','scope','scopes','timeline','load','wage'].includes(location.view) ? location.view : 'sheet';
      const tab = view === 'sheet' ? (folder?folder.name+(sheet?' / ':''):'')+(sheet?'Tab ' + (sheet.num || (takeoff.sheets || []).indexOf(sheet) + 1):'')
        : {summary:'Summary',scope:'Scope',scopes:'Scopes',timeline:'Timeline',load:'Load calc',wage:'Wage calc'}[view];
      return {list:list.id,company:company.id,project:project.id,takeoff:takeoff.id,sheet:sheet?.id || '',view,tab,
        ...(folders.length?{folder:folder?.id||''}:{}),
        listName:list.name || 'Projects',companyName:company.name || 'Untitled customer',
        projectName:project.name || 'Untitled project',takeoffName:takeoff.name || 'Untitled takeoff'};
    }
  }
  return null;
}
