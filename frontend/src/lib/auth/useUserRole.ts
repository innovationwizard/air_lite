'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Role } from './roles';

interface UserProfile {
  role: Role;
  displayName: string | null;
  email: string;
}

/**
 * Client-side hook to get the current user's role and profile.
 * Fetches from user_profiles on mount.
 */
export function useUserRole() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProfile() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from('user_profiles')
        .select('role, display_name')
        .eq('id', user.id)
        .single();

      if (data) {
        setProfile({
          role: data.role as Role,
          displayName: data.display_name,
          email: user.email ?? '',
        });
      }
      setLoading(false);
    }

    fetchProfile();
  }, []);

  return { profile, loading };
}
