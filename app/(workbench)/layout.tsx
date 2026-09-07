import type { ReactNode } from 'react';
import { AppShell } from '@/components/workbench/workbench-shell';

export default function Layout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
