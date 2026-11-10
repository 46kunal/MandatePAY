export const metadata = {
  title: { default: 'MandatePay', template: '%s · MandatePay' },
  description: 'Intent-backed agent purchases and fair dispute resolution on PayPal',
};

export const viewport = { themeColor: '#2563eb' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
