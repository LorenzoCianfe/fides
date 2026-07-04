import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

const appName = process.env.APP_NAME ?? 'Fides';

export const metadata: Metadata = {
  title: `${appName} — Banking, made clear`,
  description: 'Simulated-core EU neobank. Customer web application.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
