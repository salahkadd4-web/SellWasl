import type { Metadata, Viewport } from 'next';
import { Poppins } from 'next/font/google';
import './globals.css';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
});

export const metadata: Metadata = {
  title: 'SellWasl',
  description: 'One Platform. Every Flow.',
  icons: { icon: '/logo.png' },
};

export const viewport: Viewport = {
  themeColor: '#001850',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={poppins.variable}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
