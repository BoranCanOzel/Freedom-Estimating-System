// Leave modified clicks and middle clicks to the browser's native link handling.
export const currentTabClick=event=>event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey;
export function clearPageLink(page){
  const url=new URL(location.href);
  if(url.searchParams.get('page')===page){url.searchParams.delete('page');history.replaceState(history.state,'',url.pathname+url.search+url.hash);}
}
