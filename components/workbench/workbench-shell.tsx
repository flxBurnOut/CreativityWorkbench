import type { ReactNode } from 'react';

export function AppShell({ children }: { children: ReactNode }) {
  return <main className="app-shell">{children}</main>;
}
