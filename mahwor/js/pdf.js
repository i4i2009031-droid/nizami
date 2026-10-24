/** Offline-first Arabic PDF rendering (canvas rasterization + embedded JPEG, no CDN). */
import {dateOnly} from './accounting-primitives.js';
import {invoiceLineAmount} from './invoice-math.js';
const enc=new TextEncoder();
const ltr=value=>'\u2066'+String(value??'')+'\u2069';
const appendAll=arrays=>{const n=arrays.reduce((s,a)=>s+a.length,0),out=new Uint8Array(n);let p=0;for(const a of arrays){out.set(a,p);p+=a.length;}return out;};
function buildPdf(pages,format={width:595.28,height:841.89}){
 const chunks=[];let offset=0,offsets=[0];
 const append=x=>{const b=typeof x==='string'?enc.encode(x):x;chunks.push(b);offset+=b.length;};
 function obj(n,...value){offsets[n]=offset;append(`${n} 0 obj\n`);for(const x of value)append(x);append('\nendobj\n');}
 append('%PDF-1.4\n%QATFAH\n');const ids=pages.map((_,i)=>3+i*3);
 obj(1,'<< /Type /Catalog /Pages 2 0 R >>');obj(2,`<< /Type /Pages /Kids [${ids.map(x=>x+' 0 R').join(' ')}] /Count ${pages.length} >>`);
 pages.forEach((p,i)=>{
  const id=ids[i],content=`q ${format.width} 0 0 ${format.height} 0 0 cm /Im${i} Do Q`;
  obj(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${format.width} ${format.height}] /Resources << /XObject << /Im${i} ${id+2} 0 R >> >> /Contents ${id+1} 0 R >>`);
  obj(id+1,`<< /Length ${enc.encode(content).length} >>\nstream\n`,content,'\nendstream');
  obj(id+2,`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`,p.bytes,'\nendstream');
 });
 const cross=offset;append(`xref\n0 ${3+pages.length*3}\n0000000000 65535 f \n`);
 for(let i=1;i<3+pages.length*3;i++)append(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
 append(`trailer\n<< /Size ${3+pages.length*3} /Root 1 0 R >>\nstartxref\n${cross}\n%%EOF`);
 return new Blob(chunks,{type:'application/pdf'});
}
function jpeg(canvas){const raw=atob(canvas.toDataURL('image/jpeg',.9).split(',')[1]),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return {width:canvas.width,height:canvas.height,bytes};}
function canvas(w,h){const el=document.createElement('canvas');el.width=w;el.height=h;const c=el.getContext('2d');c.fillStyle='white';c.fillRect(0,0,w,h);c.direction='rtl';return [el,c];}
function text(c,s,x,y,size=22,color='#16283c',bold=false,align='right',maxWidth){
 c.fillStyle=color;c.font=`${bold?'bold ':' '}${size}px Tahoma, Arial, sans-serif`;c.textAlign=align;c.fillText(String(s??''),x,y,maxWidth);
}
function line(c,x,y,x2,y2,color='#e2e6eb'){c.beginPath();c.strokeStyle=color;c.lineWidth=1.5;c.moveTo(x,y);c.lineTo(x2,y2);c.stroke();}
function wrapText(c,value,width,size=19,bold=false){
 c.font=`${bold?'bold ':''}${size}px Tahoma, Arial, sans-serif`;
 const lines=[];
 for(const paragraph of String(value??'').split(/\r?\n/)){
  let current='';
  for(const word of paragraph.split(/\s+/).filter(Boolean)){
   const candidate=current?current+' '+word:word;
   if(c.measureText(candidate).width<=width){current=candidate;continue;}
   if(current){lines.push(current);current='';}
   for(const char of word){
    if(current&&c.measureText(current+char).width>width){lines.push(current);current='';}
    current+=char;
   }
  }
  lines.push(current);
 }
 return lines.length?lines:[''];
}
async function loadLogo(logo){if(!logo)return null;try{const img=new Image();img.src=logo;await img.decode();return img;}catch{return null;}}
function imageContain(c,img,x,y,w,h){const ratio=Math.min(w/img.width,h/img.height);const sw=img.width*ratio,sh=img.height*ratio;c.drawImage(img,x+(w-sw)/2,y+(h-sh)/2,sw,sh);}
const symbols={YER:'ر.ي',USD:'USD',SAR:'ر.س'};
function m(n,c='YER'){return new Intl.NumberFormat('en-US',{minimumFractionDigits:c==='YER'?0:2,maximumFractionDigits:c==='YER'?0:2}).format(Number(n)||0)+' '+(symbols[c]||'ر.ي');}
export async function makeInvoicePdf({event,brandInfo={},party={},balanceText=''}){
 if(document.fonts?.ready)await document.fonts.ready;
 const p=event.payload,currency=p.currency||'YER',items=p.items||[],W=1480,H=1046;
 const maxRows=9,pages=[],chunks=items.length?Array.from({length:Math.ceil(items.length/maxRows)},(_,i)=>items.slice(i*maxRows,(i+1)*maxRows)):[[]];
 const logo=await loadLogo(brandInfo.logo),title=p.kind==='purchase'?'فاتورة مشتريات':'فاتورة بيع';
 for(let page=0;page<chunks.length;page++){
  const [el,c]=canvas(W,H);c.fillStyle='#132b46';c.fillRect(0,0,W,9);
  if(logo)imageContain(c,logo,690,34,100,100);
  text(c,brandInfo.name||'محور الحسابات',1395,79,34,'#132b46',true);
  text(c,brandInfo.address||'اليمن',1395,120,19,'#576478');
  text(c,[brandInfo.phone&&ltr(brandInfo.phone),brandInfo.email&&ltr(brandInfo.email)].filter(Boolean).join(' • '),1395,150,17,'#687484');
  text(c,brandInfo.name||'محور الحسابات',83,81,25,'#132b46',true,'left');
  text(c,brandInfo.commercialId?`السجل التجاري: ${brandInfo.commercialId}`:'نظام محور الحسابات للمحاسبة والمبيعات',83,120,17,'#677383',false,'left');
  text(c,title,740,155,27,'#152c48',true,'center');
  line(c,40,182,1440,182,'#9ba6b5');
  const fields=[['رقم الفاتورة',p.invoiceNumber||`INV-${event.id.slice(0,8).toUpperCase()}`],['النوع / التاريخ',`${title} • ${ltr(dateOnly(event.at))}`],['العملة / الإجمالي',m(p.total,currency)]];
  fields.forEach((f,i)=>{const x=40+i*467;c.strokeStyle='#aeb9c4';c.strokeRect(x,194,467,81);text(c,f[0],x+448,221,16,'#728093');text(c,f[1],x+448,256,22,'#0f2942',true);});
  c.fillStyle='#e9eff6';c.fillRect(40,298,1400,54);text(c,'م',1408,334,20,'#102942',true);text(c,'الصنف / الخدمة',1290,334,20,'#102942',true);text(c,'الكمية',620,334,20,'#102942',true);text(c,'السعر',408,334,20,'#102942',true);text(c,'الإجمالي',180,334,20,'#102942',true);
  const rowH=49,start=352;
  chunks[page].forEach((item,j)=>{const y=start+j*rowH;
   if(j%2===1){c.fillStyle='#fafbfe';c.fillRect(40,y,1400,rowH);}
   line(c,40,y+rowH,1440,y+rowH,'#e5e9ef');
   text(c,String(page*maxRows+j+1),1409,y+33,18,'#26394c');
   text(c,item.title||item.name||'',1290,y+33,21,'#26394c',false,'right',610);
   text(c,item.qty,620,y+33,19,'#26394c');
   text(c,m(item.price,currency),408,y+33,19,'#26394c');
   const lineAmount=p.roundingMode==='per_line'?invoiceLineAmount(item.qty,item.price,currency):(Number(item.qty)||0)*(Number(item.price)||0);
   text(c,m(lineAmount,currency),180,y+33,20,'#132b46',true);
  });
  c.strokeStyle='#b0bdca';c.strokeRect(40,298,1400,530);
  if(page===chunks.length-1){
   const paid=Number(p.paid??(p.payment==='cash'?p.total:0)),left=Math.max(0,p.total-paid);
   const y=846;const labels=[['الإجمالي',p.total],['المدفوع',paid],['المتبقي',left]];
   labels.forEach(([label,val],i)=>{let x=40+i*225;c.fillStyle=i===2?'#e9f3f7':'#f8fafc';c.fillRect(x,y,213,66);c.strokeStyle='#ccd7e0';c.strokeRect(x,y,213,66);text(c,label,x+201,y+22,15,'#687588');text(c,m(val,currency),x+201,y+51,20,'#132b46',true);});
   text(c,`${p.kind==='purchase'?'المورد':'العميل'}: ${party.name||(p.kind==='purchase'?'مورد نقدي':'عميل نقدي')}`,1406,865,21,'#162a40',true);
   text(c,`ملاحظات: ${p.notes||'—'}`,1406,896,16,'#48566a',false,'right',665);
   if(balanceText)text(c,`رصيد الحساب: ${balanceText}`,1406,932,18,'#162a40',true,'right',1360);
  }else text(c,'يتبع في الصفحة التالية ...',1405,890,18,'#677383');
  const signatures=[['العميل',1405],['المحاسب',935],['المعتمد / الختم',465]];
  signatures.forEach(([name,x])=>{line(c,x-350,970,x,970,'#b4c0ce');text(c,name,x-10,995,14,'#677383');});
  text(c,[brandInfo.name,brandInfo.address,brandInfo.phone&&ltr(brandInfo.phone)].filter(Boolean).join(' • '),1378,1030,13,'#8c98a6');
  text(c,`${page+1}/${chunks.length}`,70,1030,16,'#8c98a6',false,'left');
  pages.push(jpeg(el));
 }
 return buildPdf(pages,{width:595.28,height:419.53});
}
export async function makePdf({title,meta=[],columns=[],rows=[],footer='',brand='محور الحسابات',logo='',contact='',address='',currency='YER'}){
 if(document.fonts?.ready)await document.fonts.ready;
 const W=1000,H=1414,pages=[],width=890,columnCount=Math.max(columns.length,1),spacing=width/columnCount;
 const logoImg=await loadLogo(logo);
 const [,measure]=canvas(W,H);
 const footerLines=wrapText(measure,footer,780,19,true),footerHeight=Math.max(78,footerLines.length*25+30),footerTop=H-48-footerHeight;
 const cells=rows.map(row=>Array.from({length:columnCount},(_,i)=>wrapText(measure,row[i]??'',spacing-24,16)));
 const headings=columns.map(value=>wrapText(measure,value,spacing-24,17,true));
 let index=0,consumed=0;
 do{
  const [el,c]=canvas(W,H);c.fillStyle='#132b46';c.fillRect(0,0,W,13);
  if(logoImg)imageContain(c,logoImg,865,47,75,75);
  text(c,brand,logoImg?851:944,100,32,'#112f45',true,'right',logoImg?665:750);
  text(c,[address,contact&&ltr(contact)].filter(Boolean).join(' • '),943,135,17,'#768395',false,'right',890);
  text(c,new Date().toLocaleDateString('ar-YE',{timeZone:'Asia/Aden'}),55,94,16,'#8190a3',false,'left');line(c,55,167,945,167);
  let y=216;
  for(const value of wrapText(c,title,890,28,true)){text(c,value,943,y,28,'#122b42',true);y+=36;}
  y+=9;
  for(const value of meta){for(const part of wrapText(c,value,890,19)){text(c,part,943,y,19,'#68778a');y+=27;}y+=4;}
  y+=22;
  if(columns.length){
   const height=Math.max(49,Math.max(...headings.map(x=>x.length))*23+20);
   c.fillStyle='#ecf1f7';c.fillRect(55,y,890,height);
   headings.forEach((parts,k)=>parts.forEach((value,j)=>text(c,value,930-k*spacing,y+26+j*23,17,'#122b42',true)));
   y+=height+3;
  }
  if(y+49>footerTop-20)throw Error('بيانات ترويسة المستند أطول من المساحة المتاحة');
  while(index<cells.length){
   const remaining=Math.max(...cells[index].map(parts=>Math.max(0,parts.length-consumed)));
   const capacity=Math.floor((footerTop-22-y-18)/22);
   if(capacity<1)break;
   const count=Math.min(remaining,capacity),height=Math.max(49,count*22+18);
   if(y+height>footerTop-20)break;
   if(index%2){c.fillStyle='#fafbfd';c.fillRect(55,y,890,height);}
   cells[index].forEach((parts,k)=>parts.slice(consumed,consumed+count).forEach((value,j)=>text(c,value,930-k*spacing,y+27+j*22,16,'#263b4d')));
   line(c,55,y+height,945,y+height,'#ecf1f4');y+=height;
   if(count===remaining){index++;consumed=0;}else{consumed+=count;break;}
  }
  pages.push([el,c]);
 }while(index<cells.length);
 const rendered=pages.map(([el,c],i)=>{
  c.fillStyle='#edf3f8';c.fillRect(55,footerTop,890,footerHeight);
  footerLines.forEach((value,j)=>text(c,value,924,footerTop+32+j*25,19,'#132b46',true));
  text(c,`${i+1}/${pages.length}`,65,footerTop+footerHeight-20,17,'#586b7a',false,'left');
  return jpeg(el);
 });
 return buildPdf(rendered);
}
function b64FromBytes(bytes){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);}
export function downloadBlob(blob,filename){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
export async function sharePdf(blob,filename,{text=""}={}){
 const plugins=window.Capacitor?.Plugins;
 if(plugins?.Filesystem&&plugins?.Share){const arr=new Uint8Array(await blob.arrayBuffer()),path='Qatfah/'+filename;await plugins.Filesystem.writeFile({path,data:b64FromBytes(arr),directory:'CACHE',recursive:true});const x=await plugins.Filesystem.getUri({path,directory:'CACHE'});await plugins.Share.share({title:filename,text,url:x.uri,dialogTitle:'مشاركة مستند محور الحسابات'});return;}
 if(navigator.share&&navigator.canShare?.({files:[new File([blob],filename,{type:'application/pdf'})]})){await navigator.share({title:filename,text,files:[new File([blob],filename,{type:'application/pdf'})]});return;}
 downloadBlob(blob,filename);
}
