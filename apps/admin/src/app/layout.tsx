import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

const appName = process.env.APP_NAME ?? 'Fides';

export const metadata: Metadata = {
  title: `${appName} Admin`,
  description: 'Simulated-core EU neobank. Internal admin back office.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
