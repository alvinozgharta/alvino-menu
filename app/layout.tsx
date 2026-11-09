import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bar Menu',
  description: 'Bar Menu',
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 3,
  themeColor: '#09090b',
  colorScheme: 'light dark',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full bg-zinc-950 text-zinc-100 antialiased">
      <body className="min-h-full m-0 p-0 overflow-x-hidden bg-zinc-950 font-sans">
        {children}
      </body>
    </html>
  );
}
