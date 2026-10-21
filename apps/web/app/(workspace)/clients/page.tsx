import type { Metadata } from 'next';
import { ClientsContent } from '../../../components/clients/clients-content';

export const metadata: Metadata = { title: 'Clients | SERP' };

export default function ClientsPage() {
  return <ClientsContent />;
}