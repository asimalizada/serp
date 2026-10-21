import type { Metadata } from 'next';
import { PageDetailContent } from '../../../../components/pages/page-detail-content';

export const metadata: Metadata = { title: 'Page detail | SERP' };

export default async function PageDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PageDetailContent key={id} pageId={id} />;
}