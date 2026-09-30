import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value)||0);
const number=value=>new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(Number(value)||0);
const ink=[31,51,65],muted=[92,105,115],rule=[216,222,227];
const text=value=>String(value??'').replace(/\r\n?/g,'\n');

// Vector text and tables: pagination never relies on screenshots or screen zoom.
export function buildTakeoffPdf(report,{fonts,date=new Date()}={}) {
  const doc=new jsPDF({orientation:'landscape',unit:'pt',format:'letter',compress:true,putOnlyUsedFonts:true});
  let font='helvetica';
  if(fonts){
    for(const [style,data] of Object.entries(fonts)){doc.addFileToVFS(`NotoSans-${style}.ttf`,data);doc.addFont(`NotoSans-${style}.ttf`,'NotoSans',style);}
    font='NotoSans';
  }
  doc.setProperties({title:report.name+' — Takeoff',subject:'Complete takeoff estimate',creator:'Freedom Estimating'});
  doc.setFont(font);doc.setLanguage('en-US');
  const width=doc.internal.pageSize.getWidth(),height=doc.internal.pageSize.getHeight(),margin=36,usable=width-margin*2;
  let y=54,section='Takeoff summary';const sections=new Map();
  const newPage=label=>{doc.addPage();y=54;section=label;};
  function table(options){
    autoTable(doc,{startY:y,margin:{top:54,bottom:42,left:margin,right:margin},tableWidth:usable,
      theme:'grid',rowPageBreak:'avoid',showHead:'everyPage',showFoot:'lastPage',
      styles:{font,fontSize:9,cellPadding:6,textColor:ink,lineColor:rule,lineWidth:.4,overflow:'linebreak',valign:'top'},
      headStyles:{fillColor:ink,textColor:255,fontStyle:'bold'},alternateRowStyles:{fillColor:[247,249,250]},
      footStyles:{fillColor:[232,238,242],textColor:ink,fontStyle:'bold'},
      ...options,willDrawPage:()=>sections.set(doc.internal.getCurrentPageInfo().pageNumber,section)});
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
  paragraph(`Prepared ${date.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}  ·  ${report.sheets.length} option page${report.sheets.length===1?'':'s'}  ·  USD`);
  const groups=report.metadata.filter(group=>group.fields.length);
  if(groups.length)table({head:[groups.map(group=>group.title)],body:[groups.map(group=>group.fields.map(([label,value])=>`${text(label)}: ${text(value)}`).join('\n\n'))],columnStyles:Object.fromEntries(groups.map((_,i)=>[i,{cellWidth:usable/groups.length}]))});
  paragraph('Option summary',{size:13,bold:true});
  const sum=key=>report.sheets.reduce((total,sh)=>total+(Number(sh.totals[key])||0),0);
  table({head:[['Option / scope','Subtotal','Fees','Grand total','Rounded total']],
    body:report.sheets.map((sh,i)=>[`${i+1}. ${sh.title||'Untitled option'}`,money(sh.totals.sub),money(sh.totals.feeSum),money(sh.totals.grand),Number(sh.roundTotal)?money(sh.totals.grandRounded):'—']),
    foot:[['All options combined',money(sum('sub')),money(sum('feeSum')),money(sum('grand')),'']],
    columnStyles:{0:{cellWidth:320},1:{halign:'right'},2:{halign:'right'},3:{halign:'right'},4:{halign:'right'}}});
  paragraph('Options are listed separately. The combined figure includes every option and does not select alternatives. Rounded amounts are shown separately from calculated totals.',{size:9});
  if(report.summaryNotes)table({head:[['Summary notes']],body:[[report.summaryNotes]]});

  for(const [index,sh] of report.sheets.entries()){
    const option=`Option ${index+1} · ${sh.title||'Untitled option'}`;
    newPage(option);paragraph(option,{size:17,bold:true});paragraph(sh.note);
    const base=[['count','Count'],['time','Time'],['days','Days'],['cost','Unit cost'],['markup','Markup %'],['sub','Subtotal'],['grand','Grand total']];
    const extra=[...(sh.flatAddEnabled?[['flat','Flat add']]:[]),
      ...sh.fees.map((fee,i)=>['fee'+i,`${fee.label||'Fee'} (${number(fee.pct)}%)`]),
      ...(!sh.hiddenCols?.includes('round')?[['round',`Rounded line (${money(Number(sh.roundStep)||1)} step)`]]:[]),
      ...sh.units.map((unit,i)=>['unit'+i,`${unit.label||'Unit'} price\nQty ${number(unit.qty)}`])];
    const rows=[],stack=[];let line=0,roundSum=0;
    const summaryValues=(totals,quantities,rounded)=>Object.fromEntries([
      ['sub',money(totals.sub)],['grand',money(totals.grand)],['round',money(rounded)],['flat',money(totals.flat)],
      ...totals.fees.map((amount,i)=>['fee'+i,money(amount)]),
      ...sh.units.map((u,i)=>['unit'+i,Number(quantities[i])?money(totals.grand/Number(quantities[i])):'—'])]);
    const close=()=>{
      const group=stack.pop();if(!group)return;
      const values=summaryValues(group,group.quantities,group.rounded);
      sh.units.forEach((unit,i)=>{values['unit'+i]+='\nQty '+number(group.quantities[i]);});
      rows.push({kind:'subtotal',label:group.name+' — subtotal',values});
    };
    for(const row of sh.rows){
      if(row.type==='section'){
        stack.push({name:row.name||'Section',sub:0,grand:0,flat:0,rounded:0,fees:sh.fees.map(()=>0),quantities:row.sectionQuantities||[]});
        const label=stack.map(g=>g.name).join(' / ');
        rows.push({kind:'section',label,note:row.note});
        continue;
      }
      if(row.type==='sectionEnd'){close();continue;}
      if(row.kind==='none'){rows.push({kind:'section',label:row.name||'Note',note:row.note});continue;}
      const totals=row.totals;roundSum+=row.rounded;
      for(const group of stack){group.sub+=totals.sub;group.grand+=totals.grand;group.flat+=totals.flat;group.rounded+=row.rounded;totals.fees.forEach((fee,i)=>group.fees[i]+=fee);}
      const label=`${++line}. ${row.name||'Unnamed item'}`;
      rows.push({kind:'item',label,note:row.note,values:{...summaryValues(totals,sh.units.map(u=>u.qty),row.rounded),count:number(row.count),time:number(row.effectiveTime),days:number(row.effectiveDays),cost:money(row.effectiveCost),markup:number(row.markup)+'%',flat:money(totals.flat)}});
    }
    while(stack.length)close();
    const total=summaryValues({...sh.totals,flat:sh.rows.reduce((sum,row)=>sum+(row.totals?.flat||0),0)},sh.units.map(u=>u.qty),roundSum);
    // One item list per option. Wide estimates wrap remaining values beneath
    // their own item instead of repeating the takeoff in separate tables.
    const columns=[...base.slice(0,-1),...extra.slice(0,2),base.at(-1)];
    const inline=extra.slice(2),cellWidth=(usable-190)/columns.length;
    const detailCells=(value,subtotal=false)=>[{content:value,colSpan:columns.length+1,styles:{fontSize:9,textColor:subtotal?ink:muted,fillColor:subtotal?[237,240,242]:[250,251,252],cellPadding:{top:4,bottom:6,left:12,right:6}}}];
    const pricing=values=>inline.filter(([key])=>values?.[key]).map(([key,label])=>{
      const value=values[key];
      const name=value.includes('\nQty ')?label.split('\n')[0]:label.replace(/\n/g,' / ');
      return name+': '+value.replace(/\n/g,' / ');
    }).join('    ·    ');
    const body=rows.length?rows.flatMap(row=>{
      const subtotal=row.kind==='subtotal';
      const cells=row.kind==='section'?[{content:row.label,colSpan:columns.length+1,styles:{fontStyle:'bold',fillColor:[225,232,237]}}]
        :[{content:row.label,styles:subtotal?{fontStyle:'bold',fillColor:[237,240,242]}:{}},...columns.map(([key])=>({content:row.values[key]||'',styles:subtotal?{fontStyle:'bold',fillColor:[237,240,242]}:{}}))];
      const detail=[text(row.note).trim(),pricing(row.values)].filter(Boolean).join('\n');
      return detail?[cells,detailCells(detail,subtotal)]:[cells];
    }):[[{content:'No line items in this option.',colSpan:columns.length+1}]];
    const foot=[['Option total',...columns.map(([key])=>total[key]||'')]];
    if(pricing(total))foot.push(detailCells(pricing(total),true));
    table({head:[['Item / description',...columns.map(([,label])=>label)]],body,foot,
      columnStyles:Object.fromEntries([[0,{cellWidth:190}],...columns.map((_,i)=>[i+1,{cellWidth,halign:'right'}])])});
    if(Number(sh.roundTotal))paragraph(`Rounded option total: ${money(sh.totals.grandRounded)} (nearest ${money(sh.roundTotal)}). Calculated total: ${money(sh.totals.grand)}.`,{bold:true});
    for(const row of sh.rows.filter(r=>r.components?.length)){
      if(y>height-190)newPage(option+' · Components');
      paragraph(`${row.name||'Item'} — component breakdown`,{size:15,bold:true});
      paragraph('Component amounts build the item unit cost; they are already included in the option totals.');
      table({head:[['Component / description','Count','Time','Days','Cost','Markup %','Amount']],body:row.components.map(p=>[[p.name,p.note].filter(Boolean).join('\n'),number(p.count),number(p.time),number(p.days),money(p.cost),number(p.markup)+'%',money(p.total)]),columnStyles:{0:{cellWidth:280}}});
    }
    const pictures=[{name:sh.title,pics:sh.pics,img:sh.img},...sh.rows];
    for(const row of pictures){
      const pics=row.pics?.length?row.pics:row.img?[{url:row.img,name:row.name}]:[];
      for(const pic of pics){
        if(!pic.url)continue;
        newPage(option+' · Pictures');paragraph([row.name||sh.title,pic.name].filter(Boolean).join(' — '),{size:14,bold:true});
        if(y>height-140)newPage(option+' · Pictures');
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
    doc.setPage(page);doc.setFont(font,'bold');doc.setFontSize(9);doc.setTextColor(...ink);
    doc.text(short(report.name,usable*.5),margin,25);
    doc.setFont(font,'normal');doc.setFontSize(8);doc.setTextColor(...muted);
    doc.text(short(sections.get(page)||'Takeoff estimate',usable*.46),width-margin,25,{align:'right'});
    doc.setDrawColor(...rule);doc.setLineWidth(.5);doc.line(margin,34,width-margin,34);doc.line(margin,height-31,width-margin,height-31);
    doc.text('Freedom Estimating  ·  '+date.toISOString().slice(0,10),margin,height-18);
    doc.text(`Page ${page} of ${pages}`,width-margin,height-18,{align:'right'});
  }
  return doc;
}
