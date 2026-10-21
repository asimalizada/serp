import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const plexSans = localFont({
  src: [
    { path: './fonts/IBMPlexSans-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/IBMPlexSans-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/IBMPlexSans-SemiBold.woff2', weight: '600', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-plex-sans',
});

const plexMono = localFont({
  src: './fonts/IBMPlexMono-Regular.woff2',
  weight: '400',
  display: 'swap',
  variable: '--font-plex-mono',
  preload: false,
});

export const metadata: Metadata = {
  title: 'SERP',
  description: 'SEO keyword tracking platform',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
