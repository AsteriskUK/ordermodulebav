'use client';

import { AppShell } from '@/components/app-shell';
import { CreateOrderForm } from '@/components/create-order-form';

export default function NewOrderPage() {
  return (
    <AppShell>
      <CreateOrderForm />
    </AppShell>
  );
}
