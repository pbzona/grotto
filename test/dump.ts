import { World, carveCove, N } from "../src/world";
const w = new World(); carveCove(w);
const ch = (l:number)=> l<=1?'~':l<=3?'-':l<=5?'.':l===6?'s':l<=9?String(l):l<=14?'m':'#';
let s='    '; for(let i=0;i<N;i++) s+= (i%10).toString(); console.log(s);
for (let j=0;j<N;j++){ let r=(j+'').padStart(3)+' '; for(let i=0;i<N;i++) r+=ch(w.level(i,j)); console.log(r); }
