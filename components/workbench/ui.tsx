'use client';

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { ImageAsset } from '@/features/projects/model';

export type IconName = 'plus' | 'arrow' | 'back' | 'search' | 'settings' | 'close' | 'more' | 'edit' | 'image' | 'trash' | 'check' | 'chevron' | 'spark' | 'copy' | 'upload' | 'book' | 'film' | 'gift' | 'globe' | 'help' | 'leaf' | 'download' | 'alert' | 'refresh' | 'expand';
const paths: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  back: <path d="M20 12H5m6-6-6 6 6 6" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  settings: <><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 1 3h4l2-2 3 1 3-3-1-3 2-3-2-3-3-1-1-3Z" /><circle cx="11.5" cy="11.5" r="3" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  edit: <><path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8" cy="8" r="1.5" /><path d="m4 17 5-5 4 4 3-3 5 5" /></>,
  trash: <><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /><path d="M20 2v4m-2-2h4" /></>,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M15 8V3H3v13h5" /></>,
  upload: <><path d="M12 16V3M7 8l5-5 5 5M4 15v5h16v-5" /></>,
  book: <><path d="M12 5v16M12 6Q7 2 3 5v14q5-2 9 2 4-4 9-2V5q-4-3-9 1Z" /></>,
  film: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M7 3v18M17 3v18M3 8h4m-4 8h4m10-8h4m-4 8h4" /></>,
  gift: <><rect x="3" y="8" width="18" height="5" rx="1" /><path d="M5 13v8h14v-8M12 8v13M12 8C2 8 6 0 10 4l2 4Zm0 0c10 0 6-8 2-4Z" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3q-7 9 0 18 7-9 0-18Z" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 2-1.5 2m0 4h.01" /></>,
  leaf: <><path d="M20 3C5 2 1 9 5 16s18 2 15-13ZM5 20l10-11" /></>,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
  alert: <><path d="m12 3 10 17H2Z" /><path d="M12 9v5m0 3h.01" /></>,
  refresh: <><path d="M20 9a8 8 0 1 0 0 6M20 3v6h-6" /></>,
  expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" />,
};
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function Button({ children, variant = 'primary', icon, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: IconName }) {
  return <button type="button" className={`button button-${variant} ${className}`} {...props}>{icon && <Icon name={icon} />}{children}</button>;
}

export function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    // React's autoFocus may run while the native dialog is still closed.
    dialog?.querySelector<HTMLElement>('input:not([type="file"]), textarea')?.focus();
    return () => { dialog?.close(); focused?.focus(); };
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === ref.current) onClose(); }}>
    <div className="modal-inner"><header className="modal-heading"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="icon-button" aria-label="关闭弹窗" onClick={onClose}><Icon name="close" /></button></header>{children}</div>
  </dialog>;
}

export function AssetImage({ asset, alt, className = '' }: { asset?: ImageAsset; alt: string; className?: string }) {
  const [url, setUrl] = useState(asset?.demoSrc ?? '');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (asset?.blob) {
      const next = URL.createObjectURL(asset.blob); setUrl(next);
      return () => URL.revokeObjectURL(next);
    }
    setUrl(asset?.demoSrc ?? '');
  }, [asset?.blob, asset?.demoSrc]);
  if (!url || failed) return <div className={`image-fallback ${className}`}><Icon name="image" size={30} /><span>{failed ? '图片暂时无法显示' : '还没有图片'}</span></div>;
  return <img src={url} className={className} alt={alt} onError={() => setFailed(true)} />;
}

export function Field({ label, hint, children, group = false }: { label: string; hint?: string; children: ReactNode; group?: boolean }) {
  const Tag = group ? 'div' : 'label';
  return <Tag className="field" role={group ? 'group' : undefined} aria-label={group ? label : undefined}><span className="field-label">{label}</span>{hint && <span className="field-hint">{hint}</span>}{children}</Tag>;
}

export function Empty({ title, description, children, icon = 'leaf', small = false }: { title: string; description: string; children?: ReactNode; icon?: IconName; small?: boolean }) {
  return <div className={`empty-state ${small ? 'empty-small' : ''}`}><span className="empty-symbol"><Icon name={icon} size={30} /></span><h3>{title}</h3><p>{description}</p>{children}</div>;
}
