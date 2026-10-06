import type { Metadata, Viewport } from 'next';
import { Poppins } from 'next/font/google';
import { Pwa } from '@/components/pwa';
import './globals.css';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
});

export const metadata: Metadata = {
  title: 'SellWasl',
  description: 'One Platform. Every Flow.',
  applicationName: 'SellWasl',
  icons: {
    icon: [
      { url: '/favicon-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  // iPhone et iPad : plein écran une fois ajouté à l'écran d'accueil (phase 22)
  appleWebApp: { capable: true, title: 'SellWasl', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#001850',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={poppins.variable}>
      <body className="min-h-dvh font-sans antialiased">
        {children}
        <Pwa />
      </body>
    </html>
  );
}
