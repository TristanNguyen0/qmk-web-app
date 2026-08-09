import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'QMK Firmware Customizer',
  description: 'Build advanced QMK firmware visually, without installing a toolchain.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <a href="/" className="brand">
            QMK Firmware Customizer
          </a>
          <nav aria-label="Main">
            <a href="/">Keyboards</a>
            <a href="/configurations">Your configurations</a>
          </nav>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
