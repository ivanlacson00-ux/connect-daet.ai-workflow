// src/hooks/useUsers.ts
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface UserProfile {
  id: string;
  email: string;
  role: string;
  created_at: string;
}

export function useUsers() {
  const supabase = useMemo(() => createClient(), []);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    setUsers(data ?? []);
    setLoading(false);
  }, [supabase]);

  // ✅ Update role in profiles (trigger will sync to app_metadata)
  const updateRole = async (userId: string, newRole: 'user' | 'approver' | 'admin') => {
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId);

    if (error) {
      console.error('Failed to update role:', error.message);
      return;
    }

    fetchUsers();
  };

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void fetchUsers();
    });

    const channel = supabase
      .channel('realtime-users')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'profiles',
      }, fetchUsers)
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [fetchUsers, supabase]);

  return { users, loading, updateRole };
}