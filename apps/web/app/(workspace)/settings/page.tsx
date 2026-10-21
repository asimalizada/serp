import type { Metadata } from 'next';
import { TimezoneSettings } from '../../../components/settings/timezone-settings';

export const metadata: Metadata = { title: 'Settings | SERP' };

export default function SettingsPage() {
  return <TimezoneSettings />;
}