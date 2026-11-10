import { Fraunces, Instrument_Sans } from 'next/font/google';

// Fraunces gives headlines a printed, ledger-like character; Instrument Sans keeps the interface clean and readable.
const display = Fraunces({ subsets: ['latin'], variable: '--font-display', axes: ['opsz'], display: 'swap' });
const body = Instrument_Sans({ subsets: ['latin'], variable: '--font-body', display: 'swap' });

export const metadata = {
  title: { default: 'MandatePay', template: '%s · MandatePay' },
  description: 'Intent-backed agent purchases and fair dispute resolution on PayPal',
};

export const viewport = { themeColor: '#f5f1e9' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
