'use client';
import {useEffect, useRef, useState} from 'react';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import type {Scene, WebGLRenderer} from 'three';
import {Button} from '@/components/workbench/ui';
import {craftModelPath, createDemandRender, disposeModel, readModelResponse, validatePreviewGlb} from './craft-viewer-resources.mjs';

export function CraftViewer({fileId, title}: {fileId: string; title: string}) {
  const container = useRef<HTMLDivElement>(null);
  const actions = useRef<{reset: () => void; zoom: (factor: number) => void} | null>(null);
  const [error, setError] = useState(''), [ready, setReady] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let live = true, renderer: WebGLRenderer | undefined, scene: Scene | undefined, controls: OrbitControls | undefined;
    let resizeObserver: ResizeObserver | undefined, intersection: IntersectionObserver | undefined;
    let demand: ReturnType<typeof createDemandRender> | undefined, onscreen = true;
    let visibility: (() => void) | undefined, lost: ((event: Event) => void) | undefined;
    const controller = new AbortController();
    setError(''); setReady(false); actions.current = null;
    const release = () => {
      actions.current = null; demand?.dispose(); resizeObserver?.disconnect(); intersection?.disconnect(); controls?.dispose();
      if (visibility) document.removeEventListener('visibilitychange', visibility);
      if (renderer && lost) renderer.domElement.removeEventListener('webglcontextlost', lost);
      disposeModel(scene); scene?.clear();
      if (renderer) { renderer.renderLists.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); }
      scene = undefined; renderer = undefined; controls = undefined;
    };
    void (async () => {
      const path = craftModelPath(fileId);
      const [THREE, {GLTFLoader}, {OrbitControls: Controls}] = await Promise.all([
        import('three'), import('three/addons/loaders/GLTFLoader.js'), import('three/addons/controls/OrbitControls.js'),
      ]);
      if (!live) return;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]);
      const response = await fetch(path, {signal, credentials: 'same-origin', redirect: 'error'});
      const buffer = await readModelResponse(response, signal);
      validatePreviewGlb(buffer);
      if (!live) return;
      const manager = new THREE.LoadingManager();
      manager.setURLModifier(url => { if (!url.startsWith('blob:')) throw new Error('模型引用了不允许加载的资源。'); return url; });
      const gltf = await new GLTFLoader(manager).parseAsync(buffer, '');
      if (!live) { disposeModel({traverse: (visit: (value: unknown) => void) => { for (const item of gltf.scenes) item.traverse(visit); }}); return; }
      scene = new THREE.Scene(); scene.background = new THREE.Color('#eeeede');
      // Include every parsed scene in disposal, even if the file contains an
      // unused scene. Generated files normally contain exactly one scene.
      for (const item of gltf.scenes) { item.visible = item === gltf.scene; scene.add(item); }
      const model = gltf.scene, bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
      if (bounds.isEmpty() || ![size.x, size.y, size.z, center.x, center.y, center.z].every(Number.isFinite)) throw new Error('模型没有可展示的网格。');
      model.position.sub(center);
      const radius = Math.max(size.length() / 2, 0.01), camera = new THREE.PerspectiveCamera(38, 1, radius / 100, radius * 100);
      renderer = new THREE.WebGLRenderer({antialias: true, alpha: false, powerPreference: 'low-power'});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute('aria-label', title + '，可旋转和缩放的三维预览');
      renderer.domElement.setAttribute('role', 'img'); renderer.domElement.tabIndex = 0;
      host.appendChild(renderer.domElement);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x9b967e, 2.5));
      const key = new THREE.DirectionalLight(0xfff2d9, 3); key.position.set(3, 5, 4); scene.add(key);
      const fill = new THREE.DirectionalLight(0xdce8ff, 2); fill.position.set(-4, 1, -2); scene.add(fill);
      controls = new Controls(camera, renderer.domElement); controls.enableDamping = false; controls.autoRotate = false;
      controls.minDistance = radius * 0.3; controls.maxDistance = radius * 12;
      controls.listenToKeyEvents(renderer.domElement);
      demand = createDemandRender(() => renderer?.render(scene!, camera), requestAnimationFrame, cancelAnimationFrame);
      controls.addEventListener('change', demand.request);
      const reset = () => { controls!.target.set(0, 0, 0); camera.position.set(radius * 2.3, radius * 1.5, radius * 2.8); controls!.update(); demand!.request(); };
      actions.current = {reset, zoom: factor => { camera.position.sub(controls!.target).multiplyScalar(factor).add(controls!.target); controls!.update(); demand!.request(); }};
      const resize = () => {
        if (!renderer || !host.clientWidth || !host.clientHeight) return;
        camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix();
        renderer.setSize(host.clientWidth, host.clientHeight, false); demand!.request();
      };
      resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host);
      visibility = () => demand?.visible(onscreen && document.visibilityState !== 'hidden');
      intersection = new IntersectionObserver(entries => { onscreen = entries[0]?.isIntersecting ?? false; visibility!(); }); intersection.observe(host);
      document.addEventListener('visibilitychange', visibility);
      lost = event => { event.preventDefault(); controller.abort(); release(); if (live) { setReady(false); setError('三维预览暂时中断，请重新加载。文件已保存，仍可下载。'); } };
      renderer.domElement.addEventListener('webglcontextlost', lost);
      resize(); reset(); visibility(); setReady(true);
    })().catch(reason => {
      release();
      if (live && !controller.signal.aborted) { setReady(false); setError(reason instanceof Error ? reason.message : '三维预览加载失败，文件仍可下载。'); }
    });
    return () => { live = false; controller.abort(); release(); };
  }, [fileId, title, attempt]);
  return <div className="craft-viewer-wrap">
    <div className="craft-viewer" ref={container}>
      {!ready && <div className="craft-viewer-message" role={error ? 'alert' : 'status'}>{error ? <><p>{error}</p><Button variant="secondary" onClick={() => setAttempt(value => value + 1)}>重新加载预览</Button></> : <p>正在加载三维预览…</p>}</div>}
    </div>
    <div className="craft-viewer-toolbar"><p>拖动旋转 · 滚轮缩放 · 右键拖动平移</p><div className="inline-actions"><Button variant="ghost" disabled={!ready} aria-label="放大三维模型" onClick={() => actions.current?.zoom(0.8)}>放大</Button><Button variant="ghost" disabled={!ready} aria-label="缩小三维模型" onClick={() => actions.current?.zoom(1.25)}>缩小</Button><Button variant="secondary" disabled={!ready} onClick={() => actions.current?.reset()}>复位视角</Button></div></div>
  </div>;
}
