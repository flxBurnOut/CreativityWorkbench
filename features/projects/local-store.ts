import { emptyWorkspace, parseStoredWorkspace, type StoredWorkspace, type Workspace } from './model';

const DATABASE = 'lingnan-creative-workbench';
const STORE = 'workspace';
let opening: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('此浏览器无法使用本地草稿存储。')); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => { opening = null; reject(new Error('无法打开本地草稿存储。')); };
    request.onblocked = () => { opening = null; reject(new Error('请关闭其他旧版工作台页面后重试。')); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
  });
  return opening;
}

export async function loadWorkspace(): Promise<{ workspace: Workspace; revision: number }> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const read = tx.objectStore(STORE).get('current');
    tx.onerror = () => reject(new Error('无法读取本地草稿，请重试。'));
    tx.oncomplete = () => {
      try { resolve(read.result === undefined ? { workspace: emptyWorkspace(), revision: 0 } : parseStoredWorkspace(read.result)); }
      catch (error) { reject(error); }
    };
  });
}

export async function saveWorkspace(workspace: Workspace, expectedRevision: number): Promise<number> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const read = store.get('current');
    let conflict = false;
    read.onsuccess = () => {
      if ((read.result?.revision ?? 0) !== expectedRevision) { conflict = true; tx.abort(); return; }
      const value: StoredWorkspace = { version: 1, revision: expectedRevision + 1, workspace };
      store.put(value, 'current');
    };
    tx.oncomplete = () => resolve(expectedRevision + 1);
    tx.onabort = () => reject(new Error(conflict ? '另一页面更新了草稿。请刷新读取最新内容；当前页面的修改尚未暂存。' : '暂存失败，可能是浏览器空间不足。请保留页面并重试。'));
    tx.onerror = () => { /* The abort handler reports the final transaction outcome. */ };
  });
}

export async function imageFromFile(file: File): Promise<Blob> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPG 或 WebP 图片。');
  if (file.size > 8 * 1024 * 1024) throw new Error('图片请小于 8 MB。');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('这张图片无法打开，请换一张试试。'); });
  const tooLarge = bitmap.width * bitmap.height > 40_000_000;
  bitmap.close();
  if (tooLarge) throw new Error('图片尺寸过大，请缩小到 4000 万像素以内。');
  return file;
}
