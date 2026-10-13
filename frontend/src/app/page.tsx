import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/server';
import { getDefaultPage } from '@/lib/auth/roles';

export default async function Home() {
  const user = await getAuthUser();
  redirect(user ? getDefaultPage(user.role) : '/login');
}
