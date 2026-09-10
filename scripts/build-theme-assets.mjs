// Reproducible, original vector illustrations. No scraped or AI-generated media.
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {themeAssets} from '../workbench/theme-assets/catalog.mjs';
const directory=fileURLToPath(new URL('../public/theme-assets/lingnan-v1/',import.meta.url));
await mkdir(directory,{recursive:true});
const repeat=(n,draw)=>Array.from({length:n},(_,i)=>draw(i)).join('');
const rect=(x,y,w,h,fill,extra='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
const circle=(x,y,r,fill,extra='')=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${extra}/>`;
const path=(d,fill,extra='')=>`<path d="${d}" fill="${fill}" ${extra}/>`;
const line=(x1,y1,x2,y2,stroke,width=2)=>`<path d="M${x1} ${y1}L${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`;
const group=(transform,body)=>`<g transform="${transform}">${body}</g>`;
const leaf=(x,y,rotation,color='#377468',scale=1)=>group(`translate(${x} ${y}) rotate(${rotation}) scale(${scale})`,path('M0 0Q-38 -70 0 -132Q38 -70 0 0Z',color)+line(0,-4,0,-113,'#b8c9a1',2));
const flower=(x,y,s=1)=>group(`translate(${x} ${y}) scale(${s})`,repeat(8,i=>group(`rotate(${i*45})`,path('M0 0C-43 -32 -29 -98 0 -107C29 -98 43 -32 0 0','#ba5540')))+circle(0,0,21,'#d8a04d')+circle(0,0,9,'#f7e8cb'));
const window=(x,y,w=92,h=140)=>group(`translate(${x} ${y})`,rect(-7,-7,w+14,h+14,'#d7b58c')+rect(0,0,w,h,'#2e625b')+rect(8,8,w/2-13,h-16,'#8fae99')+rect(w/2+5,8,w/2-13,h-16,'#417a6b')+repeat(7,i=>line(10,18+i*16,w-10,18+i*16,'#28594f',4))+rect(-15,h+7,w+30,10,'#fbedd5'));
function building(x,y,w,h,color) {
  return group(`translate(${x} ${y})`,rect(0,0,w,h,color)+rect(-8,-8,w+16,16,'#f7e7c8')+rect(-12,-22,w+24,10,'#314e4b')+rect(0,37,w,10,'#f4e2c0')+
    repeat(2,i=>window(28+i*(w/2),75,w/2-54,136))+rect(-5,234,w+10,13,'#f8eacf')+rect(0,258,w,h-258,'#294e48')+
    repeat(2,i=>group(`translate(${i*w/2} 258)`,path(`M0 0H${w/2}V75Q${w/4} 6 0 75Z`,color)+rect(0,0,17,h-258,'#efdabb')+rect(w/2-17,0,17,h-258,'#d7b893')))+
    rect(31,320,w-62,24,'#b46342')+repeat(6,i=>line(40+i*(w-80)/5,358,40+i*(w-80)/5,h-5,'#608773',3)));
}
const artwork={
  'qilou-street':()=>rect(0,0,1600,900,'#e9e2cc')+circle(259,230,146,'#e9bb77')+path('M0 528Q350 439 648 490T1600 440V900H0Z','#c8d4c3')+
    path('M0 720L1600 610V900H0Z','#8ba99b')+path('M0 785L1600 672V728L0 855Z','#d8caae')+
    building(613,246,240,388,'#e5bd84')+building(853,204,246,432,'#c99167')+building(1099,260,225,379,'#ebd2a6')+building(1324,184,270,460,'#bfaa8c')+
    repeat(6,i=>line(600+i*170,697,450+i*212,899,'#739181',2))+group('translate(1018 680)',circle(0,-43,13,'#334b43')+path('M-15 -23Q0 -30 15 -23L27 30H-26Z','#ac5340')+line(-9,30,-17,70,'#344d45',7)+line(12,30,23,70,'#344d45',7))+
    group('translate(1200 716)',path('M-65 -55Q0 -128 65 -55Z','#cf894e')+line(0,-56,0,13,'#294e48',4)+circle(0,-24,12,'#d7a975')+rect(-15,-9,30,54,'#f2dfb4')+line(-8,45,-15,82,'#2f594e',6)+line(9,45,18,82,'#2f594e',6))+
    path('M13 883Q148 657 80 484M66 661Q199 478 352 463','none','stroke="#2c6153" stroke-width="16"')+leaf(54,741,-34,'#285d4c',2)+leaf(98,626,67,'#37715c',1.6)+leaf(166,567,15,'#729477',1.5)+leaf(263,500,55,'#477b62',1.2),
  'arcade-rain':()=>rect(0,0,1200,900,'#87aaa2')+repeat(45,i=>line(i*37,30+(i%5)*12,i*37-119,680+(i%3)*50,'#c4d4bd',2))+
    path('M0 680L900 547L1200 666V900H0Z','#547d73')+repeat(7,i=>line(0,725+i*36,1150,625+i*23,'#a0b5a0',3))+
    path('M0 0H900L582 260H0Z','#2b534d')+path('M0 260H582L444 422H0Z','#486f60')+
    repeat(4,i=>{const s=1-i*.18;return group(`translate(${125+i*191} ${i*93}) scale(${s})`,rect(-28,0,56,800,'#eed9af')+rect(-43,0,86,36,'#b9956c')+rect(-43,778,86,27,'#d8bb88')+path('M27 143Q94 30 193 58V0H27Z','#e3c596'));})+
    path('M0 892L691 572L721 597L225 900Z','#c6c29e')+group('translate(874 615)',path('M-125 -22Q0 -181 125 -22Q77 -44 45 -23Q0 -46 -45 -23Q-84 -43 -125 -22Z','#c7814a')+line(0,-100,0,100,'#344f43',6)+circle(-25,1,20,'#2b4e44')+path('M-50 25H0L14 138H-71Z','#f2ddb9')+line(-44,137,-57,224,'#244b42',12)+line(-8,138,17,218,'#244b42',12))+path('M734 876Q907 821 1078 865','none','stroke="#b8c7b3" stroke-width="5"'),
  'manzhou-window':()=>rect(0,0,1000,1000,'#e5d7b8')+rect(148,78,726,862,'#c4af86')+rect(123,63,734,862,'#4d6855')+rect(153,93,674,802,'#926647')+
    repeat(7,i=>repeat(8,j=>rect(170+i*91,110+j*96,79,84,['#d09a55','#5f9b91','#a4493e','#b8c7ad'][(i+j*3)%4])))+
    rect(297,286,406,452,'#684e36')+rect(313,302,374,420,'#f4e4bd')+circle(500,493,128,'#e7d39e')+
    path('M372 676Q492 578 524 356','none','stroke="#477c64" stroke-width="7"')+leaf(464,564,-50,'#6b916b',.8)+leaf(503,480,35,'#3d7c67',.7)+leaf(432,615,-35,'#80a276',.7)+flower(520,378,.53)+flower(448,545,.39)+rect(116,916,748,25,'#65523c'),
  'garden-courtyard':()=>rect(0,0,1600,900,'#e5dac0')+rect(375,123,853,660,'#bfd1bb')+circle(1024,286,114,'#edcb8a')+path('M374 585Q612 509 776 575T1225 569V785H374Z','#87aaa0')+
    repeat(6,i=>path(`M${510+(i%2)*83} ${623+i*24}h${446-i*45}`,'none','stroke="#d9deba" stroke-width="3"'))+
    path('M750 585L742 469L820 381L895 476L879 585Z','#73867a')+leaf(1090,639,-39,'#426e5b',2)+leaf(1062,613,15,'#6f906b',1.6)+leaf(1138,655,50,'#365d4e',2.1)+
    path('M0 0H1600V900H0ZM335 130V788H1265V130Z','#eee2c5','fill-rule="evenodd"')+path('M293 96H1307V817H293ZM335 130V788H1265V130Z','#416b5b','fill-rule="evenodd"')+
    rect(277,81,1046,26,'#ac875e')+rect(304,818,990,21,'#ba9970')+rect(0,838,1600,62,'#9aab90')+repeat(5,i=>line(270+i*244,841,201+i*281,900,'#6f8a73',2))+
    group('translate(124 672)',rect(-39,0,99,112,'#b76647')+leaf(0,0,-52,'#4c7c5e',1.5)+leaf(1,0,-6,'#739470',2)+leaf(8,0,47,'#2f6452',1.7)),
  'guangcai-floral':()=>rect(0,0,1000,1000,'#28594f')+circle(517,532,395,'#1f4b43')+circle(500,491,395,'#dfb771')+circle(500,491,374,'#f7e7c5')+circle(500,491,315,'none','stroke="#bd8f48" stroke-width="5"')+
    repeat(16,i=>group(`translate(500 491) rotate(${i*22.5}) translate(0 -349)`,path('M0 -14Q-20 -7 -10 14Q0 3 10 14Q20 -7 0 -14','#8e4b3a')))+
    path('M306 668Q490 635 666 303','none','stroke="#a28548" stroke-width="9"')+leaf(416,603,-58,'#377b66',1.45)+leaf(504,520,36,'#4b8466',1.5)+leaf(571,437,-51,'#71986f',1.25)+leaf(619,374,63,'#4a7a60',1.15)+flower(381,418,1.04)+flower(661,589,.84)+flower(621,287,.51)+
    repeat(8,i=>circle(309+i*55,720+(i%2)*13,4,'#bc9359')),
  'foshan-paper':()=>rect(0,0,1000,1000,'#ecdfc1')+rect(76,80,861,860,'#d6b477')+rect(62,62,860,860,'#255c51')+rect(89,89,806,806,'none','stroke="#bb894a" stroke-width="12"')+
    circle(492,492,317,'#d6ae64')+circle(492,492,289,'#eee1bc')+
    repeat(8,i=>group(`translate(492 492) rotate(${i*45})`,path('M-13 -8C-119 -88 -142 -197 -22 -250C-31 -186 -9 -151 0 -137C9 -151 31 -186 22 -250C142 -197 119 -88 13 -8Z','#ab4636')+path('M-47 -86Q-93 -143 -61 -183Q-43 -128 -47 -86Z','#eee1bc')+path('M47 -86Q93 -143 61 -183Q43 -128 47 -86Z','#eee1bc')))+
    circle(492,492,84,'#ba5139')+repeat(8,i=>group(`translate(492 492) rotate(${i*45})`,path('M0 -62Q-35 -31 0 -9Q35 -31 0 -62','#eddaaf')))+circle(492,492,14,'#e5b76d')+
    repeat(4,i=>group(`translate(492 492) rotate(${i*90}) translate(-347 -347)`,flower(0,0,.48)+leaf(15,58,104,'#c2a365',.7)+leaf(54,13,-16,'#c2a365',.7))),
};
for(const a of themeAssets) {
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${a.width} ${a.height}" width="${a.width}" height="${a.height}" role="img"><title>${a.name}</title><desc>${a.alt}。${a.description}</desc>${artwork[a.id]()}</svg>`;
  await writeFile(`${directory}/${a.id}.svg`,svg);
  await sharp(Buffer.from(svg)).png().toFile(`${directory}/${a.id}.png`);
  await sharp(Buffer.from(svg)).resize({width:360}).webp({quality:78}).toFile(`${directory}/${a.id}-thumb.webp`);
}
console.log(`已生成 ${themeAssets.length} 套 SVG、PNG 和预览缩略图。`);
