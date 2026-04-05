// src/hooks/useUsers.ts
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface UserProfile {
  id: string;
  email: string;
  role: string;
  created_at: string;
}

export function useUsers() {
  const supabase = createClient();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    setUsers(data ?? []);
    setLoading(false);
  };

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
    fetchUsers();

    const channel = supabase
      .channel('realtime-users')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'profiles',
      }, fetchUsers)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  return { users, loading, updateRole };
}