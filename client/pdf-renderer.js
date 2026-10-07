import { buildTakeoffPdf } from './takeoff-pdf.js';
import regular from './fonts/NotoSans-Regular.ttf';
import bold from './fonts/NotoSans-Bold.ttf';

const base64=bytes=>{let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result);};
let fonts;
export function renderPdf(report,{includeDetails=true}={}){
  fonts||={normal:base64(regular),bold:base64(bold)};
  return buildTakeoffPdf(report,{fonts,includeDetails});
}
