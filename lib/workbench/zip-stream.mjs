import {Zip,ZipPassThrough,Unzip,UnzipInflate} from 'fflate';
import {ServiceError} from './errors.mjs';
const fail=message=>{throw new ServiceError(400,'invalid_source',message);};
const safe=name=>name&&name.length<=500&&!/[\\:]/.test(name)&&![...name].some(c=>c.charCodeAt(0)<32)&&!name.startsWith('/')&&!name.split('/').some(p=>['..','.','__proto__','constructor','prototype'].includes(p));
// Store already compressed media; pull one chunk at a time so disk writing
// supplies backpressure. Neither all input files nor the final ZIP are buffered.
export async function* streamZip(entries,{signal,maxBytes=120*1024*1024}={}) {
  let chunks=[],error,total=0;const seen=new Set();
  const zip=new Zip((e,data)=>{if(e)error=e;else if(data.length)chunks.push(data);});
  try {
    for(const entry of entries) {
      signal?.throwIfAborted();
      if(!safe(entry.name)||seen.has(entry.name))fail('资料包文件名无效或重复。');seen.add(entry.name);
      const file=new ZipPassThrough(entry.name);file.mtime=new Date(2026,8,10);zip.add(file);
      for await(const chunk of entry.chunks()) {
        signal?.throwIfAborted();total+=chunk.length;
        if(total>maxBytes)throw new ServiceError(413,'too_large','网站交接资料超过 120 MB，请减少本次选择的素材。');
        file.push(chunk);if(error)throw error;
        for(const data of chunks)yield data;chunks=[];
      }
      file.push(new Uint8Array(),true);if(error)throw error;
      for(const data of chunks)yield data;chunks=[];
    }
    zip.end();if(error)throw error;for(const data of chunks)yield data;
  } finally {zip.terminate();}
}
export const textEntry=(name,text)=>({name,chunks:async function*(){yield Buffer.from(text);}});

// Source previews scan the archive in 64 KiB chunks and inflate only the requested
// member. Parallel CSS/image requests never each expand the whole website.
export async function readZipMember(chunks,wanted,{signal}={}) {
  if(!safe(wanted))fail('源码预览路径无效。');
  let count=0,total=0,memberBytes=0,complete=false,error;const buffers=[],names=new Set(),members=[];
  const unzip=new Unzip(file=>{
    members.push(file);
    if(!safe(file.name)||names.has(file.name.toLowerCase()))fail('源码 ZIP 含不安全或重复的文件路径。');
    names.add(file.name.toLowerCase());
    if(++count>5000||file.originalSize>32*1024*1024)fail('源码 ZIP 成员超过限制。');
    file.ondata=(e,data,final)=>{
      if(e){error=e;return;}
      if(file.name!==wanted)return;
      memberBytes+=data.length;if(memberBytes>32*1024*1024)fail('预览文件解压后超过 32 MB。');
      if(data.length)buffers.push(data);if(final)complete=true;
    };
    file.start();
  });
  // fflate retains chunks for members that have not been started. Start every
  // member with a discarding decoder for unselected files, avoiding that cache.
  class SelectedInflate {
    static compression=8;
    constructor(name){if(name===wanted)this.decoder=new UnzipInflate();}
    push(data,final){if(this.decoder){this.decoder.ondata=(...args)=>this.ondata(...args);this.decoder.push(data,final);}else this.ondata(null,new Uint8Array(),final);}
  }
  class SelectedStored {
    static compression=0;
    constructor(name){this.selected=name===wanted;}
    push(data,final){this.ondata(null,this.selected?data:new Uint8Array(),final);}
  }
  unzip.register(SelectedInflate);unzip.register(SelectedStored);
  try {
    for await(const chunk of chunks) {
      signal?.throwIfAborted();total+=chunk.length;if(total>128*1024*1024)fail('源码 ZIP 超过 128 MB。');
      unzip.push(chunk);if(error)throw error;
    }
    unzip.push(new Uint8Array(),true);if(error)throw error;
    if(!names.has(wanted.toLowerCase()))throw new ServiceError(404,'missing_file','源码包中没有此文件。');
    if(!complete)fail('源码文件不完整或大小无效。');
    return Buffer.concat(buffers,memberBytes);
  } catch(e) {if(e instanceof ServiceError||signal?.aborted)throw e;fail('源码 ZIP 无法解码，请重新打包。');}
  finally {for(const member of members)member.terminate();}
}
