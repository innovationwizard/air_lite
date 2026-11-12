import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/server';
import { CAN_VIEW_ADMIN, getDefaultPage, isAuthorized } from '@/lib/auth/roles';
import { ReglasClient } from './ReglasClient';

export const dynamic = 'force-dynamic';

export default async function ReglasPage() {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  if (!isAuthorized(user.role, CAN_VIEW_ADMIN)) redirect(getDefaultPage(user.role));
  return <ReglasClient />;
}
