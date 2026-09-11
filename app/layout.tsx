import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: '粤象·岭南文化创意工作台',
  description: '粤象，以岭南文化为创作背景，从一个想法出发，创作故事、视频、网站与文创作品。',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48' },
      { url: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
