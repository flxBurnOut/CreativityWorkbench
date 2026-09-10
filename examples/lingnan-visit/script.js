/* A specific finished demo, not a Runtime website template. No network APIs. */
(()=>{'use strict';
  const entries=window.LINGNAN_DEMO_DATA.entries,selected=new Set();let filter='all',storage=true,downloadUrl;
  const byId=id=>document.getElementById(id),status=byId('save-status');
  try{const saved=JSON.parse(localStorage.getItem('lingnan-visit-v1')||'[]');if(Array.isArray(saved))saved.forEach(id=>{if(entries.some(e=>e.id===id))selected.add(id);});}catch{storage=false;}
  const element=(tag,text,className)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(className)e.className=className;return e;};
  const cards=entries.map(entry=>{
    const card=element('article',null,'card'),picture=element('button',null,'card-image');picture.type='button';picture.setAttribute('aria-label','查看插画：'+entry.name);
    const img=element('img');img.src='assets/'+entry.id+'.svg';img.alt=entry.alt;img.width=entry.width;img.height=entry.height;img.loading='lazy';img.decoding='async';picture.append(img);
    picture.addEventListener('click',()=>{byId('preview-image').src=img.src;byId('preview-image').alt=entry.alt;byId('preview-caption').textContent=entry.description;byId('art-preview').showModal();});
    card.append(picture,element('p',entry.region,'region'),element('h3',entry.name.split(' · ')[1]||entry.name),element('p',entry.facts.join(' ')));
    const detail=element('details');detail.append(element('summary','文化出处与创作说明'),element('p',entry.description));
    entry.sources.forEach(s=>{const p=element('p'),a=element('a',s.title+' ↗');a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';p.append(a);detail.append(p);});
    const save=element('button',null,'save');save.type='button';save.addEventListener('click',()=>{if(selected.has(entry.id))selected.delete(entry.id);else selected.add(entry.id);renderCollection();});card.append(detail,save);byId('cards').append(card);return {card,entry,save};
  });
  function renderCollection(){
    for(const {entry,save} of cards){const active=selected.has(entry.id);save.textContent=active?'已加入行笺 ✓':'加入探索清单 +';save.setAttribute('aria-pressed',String(active));}
    byId('saved-items').replaceChildren();for(const id of selected){const e=entries.find(e=>e.id===id),li=element('li',e.name+' · '+e.region),remove=element('button','移除');remove.type='button';remove.setAttribute('aria-label','移除 '+e.name);remove.addEventListener('click',()=>{selected.delete(id);renderCollection();});li.append(remove);byId('saved-items').append(li);}
    byId('collection-empty').hidden=selected.size>0;byId('export').disabled=!selected.size;byId('nav-count').textContent=String(selected.size);
    try{if(storage)localStorage.setItem('lingnan-visit-v1',JSON.stringify([...selected]));}catch{storage=false;}
    status.textContent=storage?'已选择 '+selected.size+' 项，保存在当前浏览器。':'此预览无法持久保存；可下载清单留存。';
  }
  function renderFilter(){const query=byId('search').value.trim().toLocaleLowerCase();let count=0;for(const {card,entry} of cards){card.hidden=Boolean((filter!=='all'&&entry.kind!==filter)||(query&&![entry.name,entry.region,...entry.facts].join(' ').toLocaleLowerCase().includes(query)));if(!card.hidden)count++;}byId('result-count').textContent='找到 '+count+' 个文化主题';byId('empty').hidden=count>0;}
  document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderFilter();}));
  byId('search').addEventListener('input',renderFilter);byId('reset').addEventListener('click',()=>{byId('search').value='';document.querySelector('[data-filter="all"]').click();});
  window.LINGNAN_DEMO_DATA.story.text.split('\n\n').forEach(p=>byId('story-text').append(element('p',p)));
  const clearDownload=()=>{if(downloadUrl){URL.revokeObjectURL(downloadUrl);downloadUrl=undefined;}};
  byId('export').addEventListener('click',()=>{clearDownload();const text=['岭南行笺 · 我的探索清单','文化阅读与观察主题，非已核实的旅行路线。',...[...selected].map(id=>{const e=entries.find(e=>e.id===id);return '\n'+e.name+' / '+e.region+'\n'+e.facts.join('\n')+'\n'+e.sources.map(s=>s.title+' '+s.url).join('\n');})].join('\n');downloadUrl=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=element('a');a.href=downloadUrl;a.download='岭南行笺-探索清单.txt';a.click();setTimeout(clearDownload,1000);});
  byId('close-preview').addEventListener('click',()=>byId('art-preview').close());byId('art-preview').addEventListener('close',()=>{byId('preview-image').removeAttribute('src');});window.addEventListener('pagehide',clearDownload);
  renderCollection();renderFilter();
})();
