import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Nav } from '@/components/Nav';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Pulse',
    template: '%s - Pulse',
  },
  description: 'A real-time social feed built on a hybrid fan-out pipeline.',
};

export const viewport: Viewport = {
  // Matches the page background, so the mobile browser chrome does not sit on
  // a white strip above a dark app.
  themeColor: '#0a0c10',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>
          <Nav />
          <main className="relative z-10 mx-auto w-full max-w-2xl px-4 pb-24">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
