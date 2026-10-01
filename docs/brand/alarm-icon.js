// Parametric 'alarm reel' icon: icon(cfg) returns an SVG string (viewBox 0 0 1024 1024).
// Used by alarm-variants.html (the 50-variant sheet) and export.html (the app assets).
// cfg.bg 'none' draws no background (Android foreground / splash glyph).
const Y='#FFC21A',K='#0A0A0D',INK='#14110A',R='#FF2D3D',W='#F7F7FA',O='#FF7A1A';
const BG={Y:{f:Y},K:{f:K},R:{f:R},W:{f:W},G:{grad:[Y,O]},S:{grad:[Y,O,R]},N:{f:'#1B1B22'}};
let uid=0;
function icon(c){
  c=Object.assign({bg:'K',body:Y,ink:INK,shape:'circle',bells:'arc',legs:'sticks',face:'play',tilt:-8,dot:'tr',ring:false,
    outline:false,scale:1,shadow:false,bodyGrad:false,bellColor:null,dotColor:R,hands:[0,110]},c);
  const id='g'+(uid++);let s='';
  const bg=BG[c.bg]||{};
  s+=`<defs>`;
  if(bg.grad)s+=`<linearGradient id="${id}b" x1="0" y1="1" x2="1" y2="0">${bg.grad.map((x,i)=>`<stop offset="${i/(bg.grad.length-1)}" stop-color="${x}"/>`).join('')}</linearGradient>`;
  if(c.bodyGrad)s+=`<linearGradient id="${id}d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${Y}"/><stop offset="1" stop-color="${O}"/></linearGradient>`;
  s+=`</defs>`;
  if(c.bg!=='none')s+=`<rect width="1024" height="1024" fill="${bg.grad?`url(#${id}b)`:bg.f}"/>`;
  const body=c.bodyGrad?`url(#${id}d)`:c.body, bell=c.bellColor||c.body==='url'?c.body:(c.bellColor||c.body);
  // body geometry
  let cx=512,cy=560,w=580,h=580,top;
  if(c.shape==='phone'){w=430;h=640;cy=570}
  top=cy-h/2;
  const sc=c.scale;
  s+=`<g transform="translate(512 540) scale(${sc}) translate(-512 -540) rotate(${c.tilt} 512 560)">`;
  if(c.shadow)s+=`<ellipse cx="${cx}" cy="${cy+h/2+70}" rx="${w*0.42}" ry="34" fill="rgba(0,0,0,.28)"/>`;
  // ringing lines
  const lc=c.lineColor||(c.bg==='K'||c.bg==='N'?Y:INK);
  if(c.ring)[[-1],[1]].forEach(([d])=>{for(let k=0;k<2;k++){const rr=w/2+70+k*60,a0=d<0?200:-20,a1=d<0?160:20;
    const p=a=>[cx+rr*Math.cos(a*Math.PI/180),cy+rr*Math.sin(a*Math.PI/180)];const[x0,y0]=p(a0),[x1,y1]=p(a1);
    s+=`<path d="M${x0} ${y0} A${rr} ${rr} 0 0 ${d<0?0:1} ${x1} ${y1}" stroke="${lc}" stroke-width="34" fill="none" stroke-linecap="round" opacity="${1-k*.35}"/>`}});
  // legs
  const legC=c.outline?c.stroke:(c.bodyGrad?O:c.body);
  if(c.legs==='sticks'){const by=cy+h/2-40;s+=`<line x1="${cx-w*0.28}" y1="${by}" x2="${cx-w*0.37}" y2="${by+80}" stroke="${legC}" stroke-width="56" stroke-linecap="round"/><line x1="${cx+w*0.28}" y1="${by}" x2="${cx+w*0.37}" y2="${by+80}" stroke="${legC}" stroke-width="56" stroke-linecap="round"/>`}
  if(c.legs==='feet'){const by=cy+h/2+18;s+=`<circle cx="${cx-w*0.3}" cy="${by}" r="46" fill="${legC}"/><circle cx="${cx+w*0.3}" cy="${by}" r="46" fill="${legC}"/>`}
  // bells
  const bc=(i)=> (c.bellColor&&i===1)?c.bellColor:(c.outline?c.stroke:(c.bodyGrad?Y:c.body));
  const bl=[cx-w*0.31,top+10],br=[cx+w*0.31,top+10];
  if(c.bells==='arc'){[bl,br].forEach(([x,y],i)=>{const rr=150,a=i?[-110,-30]:[-150,-70];
    const p=t=>[x+rr*Math.cos(t*Math.PI/180)+(i?-40:40),y+60+rr*Math.sin(t*Math.PI/180)];const[x0,y0]=p(a[0]),[x1,y1]=p(a[1]);
    s+=`<path d="M${x0} ${y0} A${rr} ${rr} 0 0 1 ${x1} ${y1}" stroke="${bc(i)}" stroke-width="70" fill="none" stroke-linecap="round"/>`})}
  if(c.bells==='dome')[bl,br].forEach(([x,y],i)=>s+=`<circle cx="${x}" cy="${y+10}" r="112" fill="${bc(i)}"/>`);
  if(c.bells==='ears')[bl,br].forEach(([x,y],i)=>s+=`<circle cx="${x+(i?-12:12)}" cy="${y+20}" r="70" fill="${bc(i)}"/>`);
  if(c.bells==='nubs')[bl,br].forEach(([x,y],i)=>s+=`<circle cx="${x+(i?-30:30)}" cy="${y+40}" r="44" fill="${bc(i)}"/>`);
  if(c.bells==='single')s+=`<path d="M${cx-130} ${top+20} A130 130 0 0 1 ${cx+130} ${top+20} Z" fill="${bc(0)}"/><rect x="${cx-22}" y="${top-150}" width="44" height="60" rx="22" fill="${bc(0)}"/>`;
  // body
  const shapeEl=(fill,extra='')=>c.shape==='circle'?`<circle cx="${cx}" cy="${cy}" r="${w/2}" fill="${fill}" ${extra}/>`
    :c.shape==='squircle'?`<rect x="${cx-w/2}" y="${cy-h/2}" width="${w}" height="${h}" rx="170" fill="${fill}" ${extra}/>`
    :`<rect x="${cx-w/2}" y="${cy-h/2}" width="${w}" height="${h}" rx="120" fill="${fill}" ${extra}/>`;
  if(c.outline)s+=shapeEl(c.fill||BG[c.bg].f||K,`stroke="${c.stroke}" stroke-width="64"`);else s+=shapeEl(body);
  // face
  const ink=c.outline?c.stroke:c.ink, f=(c.shape==='phone'?0.8:1);
  const tri=(k=1,col=ink)=>{const a=57*k*f,b=115*k*f,d=133*k*f;return `<path d="M${cx-a} ${cy-b} L${cx-a} ${cy+b} L${cx+d} ${cy} Z" fill="${col}" stroke="${col}" stroke-width="${40*k}" stroke-linejoin="round"/>`};
  const hands=()=>{const[a1,a2]=c.hands.map(a=>a*Math.PI/180);return `<line x1="${cx}" y1="${cy}" x2="${cx+170*f*Math.sin(a1)}" y2="${cy-170*f*Math.cos(a1)}" stroke="${ink}" stroke-width="46" stroke-linecap="round"/><line x1="${cx}" y1="${cy}" x2="${cx+110*f*Math.sin(a2)}" y2="${cy-110*f*Math.cos(a2)}" stroke="${ink}" stroke-width="46" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="34" fill="${ink}"/>`};
  const ticks=(n=12)=>{let t='';for(let i=0;i<n;i++){const a=i/n*2*Math.PI,r1=w/2*0.72,r2=w/2*0.84;t+=`<line x1="${cx+r1*Math.sin(a)}" y1="${cy-r1*Math.cos(a)}" x2="${cx+r2*Math.sin(a)}" y2="${cy-r2*Math.cos(a)}" stroke="${ink}" stroke-width="${i%3?16:28}" stroke-linecap="round"/>`}return t};
  switch(c.face){
    case 'play':s+=tri();break;
    case 'bigplay':s+=tri(1.3);break;
    case 'hands':s+=hands();break;
    case 'clock':s+=ticks()+hands();break;
    case 'ticks':s+=ticks()+tri(.75);break;
    case 'progress':{const rr=w/2*0.78,a=270*Math.PI/180;s+=`<circle cx="${cx}" cy="${cy}" r="${rr}" stroke="${ink}" stroke-opacity=".25" stroke-width="34" fill="none"/><path d="M${cx} ${cy-rr} A${rr} ${rr} 0 1 1 ${cx-rr} ${cy}" stroke="${ink}" stroke-width="34" fill="none" stroke-linecap="round"/>`+tri(.7);break}
    case 'sleepy':s+=`<path d="M${cx-150} ${cy-20} q60 50 120 0 M${cx+30} ${cy-20} q60 50 120 0" stroke="${ink}" stroke-width="34" fill="none" stroke-linecap="round"/><ellipse cx="${cx}" cy="${cy+110}" rx="40" ry="34" fill="${ink}"/><text x="${cx+150}" y="${cy-120}" font-family="R" font-weight="900" font-size="120" fill="${ink}">z</text>`;break;
    case 'happy':s+=`<circle cx="${cx-95}" cy="${cy-40}" r="38" fill="${ink}"/><circle cx="${cx+95}" cy="${cy-40}" r="38" fill="${ink}"/><path d="M${cx-110} ${cy+60} q110 110 220 0" stroke="${ink}" stroke-width="38" fill="none" stroke-linecap="round"/>`;break;
    case 'swipe':s+=`<path d="M${cx-120} ${cy+40} L${cx} ${cy-80} L${cx+120} ${cy+40} M${cx-120} ${cy+160} L${cx} ${cy+40} L${cx+120} ${cy+160}" stroke="${ink}" stroke-width="54" fill="none" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -40)"/>`;break;
    case 'heart':s+=`<path d="M${cx} ${cy+130} C${cx-260} ${cy-20} ${cx-120} ${cy-200} ${cx} ${cy-70} C${cx+120} ${cy-200} ${cx+260} ${cy-20} ${cx} ${cy+130} Z" fill="${ink}"/>`;break;
    case 'bars':{const hs=[90,170,250,190,120,210,140];hs.forEach((hh,i)=>{const x=cx-180+i*60;s+=`<line x1="${x}" y1="${cy-hh/2}" x2="${x}" y2="${cy+hh/2}" stroke="${ink}" stroke-width="36" stroke-linecap="round"/>`});break}
    case 'record':s+=`<circle cx="${cx}" cy="${cy}" r="${w*0.2}" fill="${R}"/>`;break;
    case 'bang':s+=`<text x="${cx}" y="${cy+120}" text-anchor="middle" font-family="R" font-weight="900" font-size="380" fill="${ink}">!</text>`;break;
    case 'zplay':s+=tri()+`<text x="${cx+150}" y="${cy-130}" font-family="R" font-weight="900" font-size="110" fill="${ink}">z</text>`;break;
  }
  s+=`</g>`;
  // dot
  const dC=c.dotColor;
  if(c.dot==='tr')s+=`<circle cx="790" cy="230" r="70" fill="${dC}"/>`;
  if(c.dot==='badge')s+=`<circle cx="790" cy="230" r="96" fill="${R}"/><text x="790" y="272" text-anchor="middle" font-family="R" font-weight="900" font-size="120" fill="${W}">1</text>`;
  if(c.dot==='low')s+=`<circle cx="800" cy="800" r="64" fill="${dC}"/>`;
  return `<svg viewBox="0 0 1024 1024">${s}</svg>`;
}
