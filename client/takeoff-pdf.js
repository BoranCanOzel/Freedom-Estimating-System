import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value)||0);
const number=value=>new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(Number(value)||0);
const ink=[31,51,65],muted=[92,105,115],rule=[216,222,227];
const text=value=>String(value??'').replace(/\r\n?/g,'\n');

// Vector text and tables: pagination never relies on screenshots or screen zoom.
export function buildTakeoffPdf(report,{fonts,date=new Date(),includeDetails=true}={}) {
  const doc=new jsPDF({orientation:'landscape',unit:'pt',format:'letter',compress:true,putOnlyUsedFonts:true});
  let font='helvetica';
  if(fonts){
    for(const [style,data] of Object.entries(fonts)){doc.addFileToVFS(`NotoSans-${style}.ttf`,data);doc.addFont(`NotoSans-${style}.ttf`,'NotoSans',style);}
    font='NotoSans';
  }
  doc.setProperties({title:report.name+' — Takeoff',subject:'Complete takeoff estimate',creator:'Freedom Estimating'});
  doc.setFont(font);doc.setLanguage('en-US');
  const height=doc.internal.pageSize.getHeight(),margin=36;
  let width=doc.internal.pageSize.getWidth(),usable=width-margin*2;
  let y=54,section='Takeoff summary';const sections=new Map();
  const newPage=(label,pageWidth=width)=>{width=pageWidth;usable=width-margin*2;doc.addPage([width,height],'landscape');y=54;section=label;};
  function table(options){
    autoTable(doc,{startY:y,margin:{top:54,bottom:42,left:margin,right:margin},tableWidth:usable,
      theme:'grid',rowPageBreak:'avoid',showHead:'everyPage',showFoot:'lastPage',
      styles:{font,fontSize:9,cellPadding:6,textColor:ink,lineColor:rule,lineWidth:.4,overflow:'linebreak',valign:'top'},
      headStyles:{fillColor:ink,textColor:255,fontStyle:'bold'},alternateRowStyles:{fillColor:[247,249,250]},
      footStyles:{fillColor:[232,238,242],textColor:ink,fontStyle:'bold'},
      ...options,didParseCell:data=>{
        const align=options.columnStyles?.[data.column.index]?.halign;
        if(align&&data.cell.colSpan===1)data.cell.styles.halign=align;
        options.didParseCell?.(data);
      },willDrawPage:()=>sections.set(doc.internal.getCurrentPageInfo().pageNumber,section)});
    y=doc.lastAutoTable.finalY+12;
  }
  function paragraph(value,{size=10,bold=false}={}){
    if(!text(value).trim())return;
    if(bold&&size>=11&&y>height-135)newPage(section);
    table({body:[[text(value)]],theme:'plain',styles:{font,fontSize:size,fontStyle:bold?'bold':'normal',cellPadding:0,textColor:ink,overflow:'linebreak',lineWidth:0},alternateRowStyles:{fillColor:false}});
  }
  paragraph('TAKEOFF ESTIMATE',{size:10,bold:true});
  paragraph(report.name,{size:22,bold:true});
  paragraph([report.customer,report.project].filter(Boolean).join('  /  '),{size:12});
  paragraph(`Prepared ${date.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}  ·  ${report.sheets.length} scope${report.sheets.length===1?'':'s'}  ·  USD`);
  const groups=report.metadata.filter(group=>group.fields.length);
  if(groups.length)table({head:[groups.map(group=>group.title)],body:[groups.map(group=>group.fields.map(([label,value])=>`${text(label)}: ${text(value)}`).join('\n\n'))],columnStyles:Object.fromEntries(groups.map((_,i)=>[i,{cellWidth:usable/groups.length}]))});
  paragraph('Summary',{size:13,bold:true});
  const sum=key=>report.sheets.reduce((total,sh)=>total+(Number(sh.totals[key])||0),0);
  table({head:[['Scope','Subtotal','Fees','Grand total','Rounded total']],
    body:report.sheets.map((sh,i)=>[`${i+1}. ${sh.title||'Untitled scope'}`,money(sh.totals.sub),money(sh.totals.feeSum),money(sh.totals.grand),Number(sh.roundTotal)?money(sh.totals.grandRounded):'—']),
    foot:[[report.name+' total',money(sum('sub')),money(sum('feeSum')),money(sum('grand')),'']],
    columnStyles:{0:{cellWidth:320},1:{halign:'right'},2:{halign:'right'},3:{halign:'right'},4:{halign:'right'}}});
  if(includeDetails&&report.summaryNotes)table({head:[['Summary notes']],body:[[report.summaryNotes]]});

  for(const sh of report.sheets){
    const scopeName=text(sh.title).trim()||'Untitled scope';
    const base=[['count','Count'],['time','Time'],['days','Days'],['cost','Unit cost'],['markup','Markup %'],['sub','Subtotal'],['grand','Grand total']];
    const extra=[...(sh.flatAddEnabled?[['flat','Flat add']]:[]),
      ...sh.fees.map((fee,i)=>['fee'+i,`${fee.label||'Fee'} (${number(fee.pct)}%)`]),
      ...sh.units.map((unit,i)=>['unit'+i,`${unit.label||'Unit'} price\nQty ${number(unit.qty)}`])];
    const rows=[],stack=[];let line=0;
    const summaryValues=(totals,quantities)=>Object.fromEntries([
      ['sub',money(totals.sub)],['grand',money(totals.grand)],['flat',money(totals.flat)],
      ...totals.fees.map((amount,i)=>['fee'+i,money(amount)]),
      ...sh.units.map((u,i)=>['unit'+i,Number(quantities[i])?money(totals.grand/Number(quantities[i])):'—'])]);
    for(const row of sh.rows){
      if(row.type==='section'){
        stack.push(row.name||'Section');
        const label=stack.join(' / ');
        rows.push({kind:'section',label,note:row.note});
        continue;
      }
      if(row.type==='sectionEnd'){stack.pop();continue;}
      if(row.kind==='none'){rows.push({kind:'section',label:row.name||'Note',note:row.note});continue;}
      const totals=row.totals;
      const label=`${++line}. ${row.name||'Unnamed item'}`;
      rows.push({kind:'item',label,note:row.note,values:{...summaryValues(totals,sh.units.map(u=>u.qty)),count:number(row.count),time:number(row.effectiveTime),days:number(row.effectiveDays),cost:money(row.effectiveCost),markup:number(row.markup)+'%',flat:money(totals.flat)}});
    }
    const total=summaryValues({...sh.totals,flat:sh.rows.reduce((sum,row)=>sum+(row.totals?.flat||0),0)},sh.units.map(u=>u.qty));
    const columns=[...base.slice(0,-1),...extra,base.at(-1)];
    // Keep every pricing field in a column. Unusually wide estimates get a
    // wider page rather than tiny text, duplicate item lists, or extra rows.
    doc.setFont(font,'normal');doc.setFontSize(9);
    const widths=columns.map(([key])=>Math.max(['count','time','days'].includes(key)?44:62,
      ...[...rows.map(row=>row.values?.[key]||''),total[key]||''].flatMap(value=>text(value).split('\n').map(line=>doc.getTextWidth(line)+12))));
    newPage(scopeName,Math.max(792,190+widths.reduce((sum,w)=>sum+w,0)+margin*2));
    paragraph(scopeName,{size:17,bold:true});if(includeDetails)paragraph(sh.note);
    const descriptionWidth=usable-widths.reduce((sum,w)=>sum+w,0);
    const detailCells=value=>[{content:value,colSpan:columns.length+1,styles:{fontSize:9,textColor:muted,fillColor:[250,251,252],cellPadding:{top:4,bottom:6,left:12,right:6}}}];
    const body=rows.length?rows.flatMap(row=>{
      const cells=row.kind==='section'?[{content:row.label,colSpan:columns.length+1,styles:{fontStyle:'bold',fillColor:[225,232,237]}}]
        :[row.label,...columns.map(([key])=>row.values[key]||'')];
      const detail=includeDetails?text(row.note).trim():'';
      return detail?[cells,detailCells(detail)]:[cells];
    }):[[{content:'No line items in this scope.',colSpan:columns.length+1}]];
    const foot=[[scopeName+' total',...columns.map(([key])=>total[key]||'')]];
    table({head:[['Item / description',...columns.map(([,label])=>label)]],body,foot,
      columnStyles:Object.fromEntries([[0,{cellWidth:descriptionWidth}],...columns.map((_,i)=>[i+1,{cellWidth:widths[i],halign:'right'}])])});
    for(const row of sh.rows.filter(r=>r.components?.length)){
      if(y>height-190)newPage(scopeName+' · Components');
      paragraph(`${row.name||'Item'} — component breakdown`,{size:15,bold:true});
      paragraph('Component amounts build the item unit cost; they are already included in the scope totals.');
      table({head:[['Component / description','Count','Time','Days','Cost','Markup %','Amount']],body:row.components.map(p=>[[p.name,includeDetails?p.note:''].filter(Boolean).join('\n'),number(p.count),number(p.time),number(p.days),money(p.cost),number(p.markup)+'%',money(p.total)]),columnStyles:{0:{cellWidth:280},...Object.fromEntries([1,2,3,4,5,6].map(i=>[i,{halign:'right'}]))}});
    }
    const pictures=[{name:sh.title,pics:sh.pics,img:sh.img},...sh.rows];
    for(const row of pictures){
      const pics=row.pics?.length?row.pics:row.img?[{url:row.img,name:row.name}]:[];
      for(const pic of pics){
        if(!pic.url)continue;
        newPage(scopeName+' · Pictures');paragraph([row.name||sh.title,pic.name].filter(Boolean).join(' — '),{size:14,bold:true});
        if(y>height-140)newPage(scopeName+' · Pictures');
        try{
          if(!/^data:image\//i.test(pic.url))throw Error('Only embedded pictures are available offline');
          const image=doc.getImageProperties(pic.url),space=height-48-y,scale=Math.min(usable/image.width,space/image.height);
          doc.addImage(pic.url,image.fileType,margin,y,image.width*scale,image.height*scale);
          sections.set(doc.internal.getCurrentPageInfo().pageNumber,section);
        }catch{throw Error(`Could not include picture "${pic.name||row.name||'Picture'}". Replace or remove that picture, then save the PDF again.`);}
      }
    }
  }
  const pages=doc.getNumberOfPages();
  const short=(value,maxWidth)=>{let result=text(value).replace(/\s+/g,' ');while(result.length&&doc.getTextWidth(result)>maxWidth)result=result.slice(0,-1);return result;};
  for(let page=1;page<=pages;page++){
    doc.setPage(page);width=doc.internal.pageSize.getWidth();usable=width-margin*2;doc.setFont(font,'bold');doc.setFontSize(9);doc.setTextColor(...ink);
    doc.text(short(report.name,usable*.5),margin,25);
    doc.setFont(font,'normal');doc.setFontSize(8);doc.setTextColor(...muted);
    doc.text(short(sections.get(page)||'Takeoff estimate',usable*.46),width-margin,25,{align:'right'});
    doc.setDrawColor(...rule);doc.setLineWidth(.5);doc.line(margin,34,width-margin,34);doc.line(margin,height-31,width-margin,height-31);
    doc.text('Freedom Estimating  ·  '+date.toISOString().slice(0,10),margin,height-18);
    doc.text(`Page ${page} of ${pages}`,width-margin,height-18,{align:'right'});
  }
  return doc;
}
