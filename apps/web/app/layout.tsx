import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Nav } from '@/components/Nav';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pulse',
  description: 'A real-time social feed built on a hybrid fan-out pipeline.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>
          <Nav />
          <main className="mx-auto w-full max-w-2xl px-4 pb-24">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
