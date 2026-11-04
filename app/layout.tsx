export const metadata = {
  title: 'MandatePay',
  description: 'Intent-backed agent purchases and fair dispute resolution on PayPal',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
