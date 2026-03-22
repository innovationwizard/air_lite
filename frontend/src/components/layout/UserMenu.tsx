'use client';

import { useRouter } from 'next/navigation';
import { LogOut, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export function UserMenu() {
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
        <User className="w-4 h-4 text-gray-500" />
      </div>
      <button
        onClick={handleLogout}
        className="flex items-center gap-1 px-2 py-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <LogOut className="w-4 h-4" />
        <span>Salir</span>
      </button>
    </div>
  );
}
