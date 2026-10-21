import type { Metadata } from 'next';
import { AddClientForm } from '../../../../components/clients/add-client-form';

export const metadata: Metadata = { title: 'Add client | SERP' };

export default function AddClientPage() {
  return <AddClientForm />;
}