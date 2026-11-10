'use client';
// OWNER: C. The buyer's orders: what they bought, who sold it, and "Report a problem".
import { PageHeader } from '../../_ui/Ui';
import { MyOrdersCard } from './MyOrders';

export default function OrdersPage() {
  return (
    <>
      <PageHeader title="My orders" subtitle="Everything you have bought, who sold it, and a quick way to report a problem." />
      <MyOrdersCard />
    </>
  );
}
