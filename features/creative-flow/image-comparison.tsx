'use client';
import {useState} from 'react';
import {AssetImage,Button,Field} from '@/components/workbench/ui';
import type {ImageAsset,ImageReview} from '@/features/projects/model';

export function ImageComparison({original,revised,onConfirm}:{original?:ImageAsset;revised:ImageAsset;onConfirm?:(review:ImageReview)=>void}) {
  const [zoom,setZoom]=useState(1);const [x,setX]=useState(50);const [y,setY]=useState(50);
  const [changes,setChanges]=useState(false);const [preserved,setPreserved]=useState(false);const [notes,setNotes]=useState('');
  return <div className="image-comparison"><p>本次修改要求：{revised.source?.instruction||'按原有修改要求逐项核对。'}</p><p className="muted">文件不同不代表修改有效。先按整体预览尺寸检查，再同步放大到雨渍、边缘、纹理等具体位置。</p>
    <div className="image-comparison-grid">{[{asset:original,label:'返工原图'},{asset:revised,label:'本轮修改图'}].map(({asset,label})=><figure key={label}><figcaption>{label}</figcaption><div className="comparison-viewport">{asset?<div style={{transform:`scale(${zoom})`,transformOrigin:`${x}% ${y}%`}}><AssetImage asset={asset} alt={label}/></div>:<p>原图不在当前素材库中，暂时无法对比。</p>}</div></figure>)}</div>
    <div className="comparison-controls"><Field label={'对比放大倍率 · '+zoom.toFixed(1)+'×'}><input type="range" aria-label="对比放大倍率" min={1} max={5} step={0.1} value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></Field><Field label="水平观察位置"><input type="range" min={0} max={100} value={x} onChange={e=>setX(Number(e.target.value))}/></Field><Field label="垂直观察位置"><input type="range" min={0} max={100} value={y} onChange={e=>setY(Number(e.target.value))}/></Field></div>
    {onConfirm&&<><label className="workflow-check"><input type="checkbox" checked={changes} onChange={e=>setChanges(e.target.checked)}/>指定修改已经清晰可辨</label><label className="workflow-check"><input type="checkbox" checked={preserved} onChange={e=>setPreserved(e.target.checked)}/>应保留的主体、构图和风格已核对</label><Field label="对比观察记录"><textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="例如：伞缘磨损清晰可见，伞柄与背景未改变。"/></Field><Button disabled={!original||!changes||!preserved||!notes.trim()} onClick={()=>onConfirm({assetId:revised.id,parentAssetId:original!.id,changesVisible:true,preserved:true,notes:notes.trim(),checkedAt:Date.now()})}>已核对，选用修改图</Button><p className="muted">若未达到要求，保留候选并继续修改；不勾选通过，也不自动重新生成。</p></>}
  </div>;
}
