// src/app/(dashboard)/workflow/admin/user_management/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

interface UserProfile {
  id: string;
  email: string;
  role: string;
  created_at: string;
}

export default function UserManagementPage() {
  const supabase = createClient();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) console.error('Fetch error:', error.message);
    setUsers(data ?? []);
    setLoading(false);
  };

  const updateRole = async (userId: string, newRole: 'user' | 'approver' | 'admin') => {
    setUpdating(userId);
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId);

    if (error) {
      console.error('Role update failed:', error.message);
    }

    setUpdating(null);
    fetchUsers();
  };

  useEffect(() => {
    fetchUsers();

    const channel = supabase
      .channel('realtime-user-management')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'profiles',
      }, fetchUsers)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const filtered = users.filter((u) =>
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const roleColor: Record<string, string> = {
    admin:    'bg-blue-100 text-blue-700',
    approver: 'bg-purple-100 text-purple-700',
    user:     'bg-gray-100 text-gray-600',
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">👥 User Management</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage user roles — changes apply on their next login
        </p>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-gray-300 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="bg-white rounded-2xl shadow p-6">
        {loading ? (
          <p className="text-gray-400">Loading users...</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">👤</p>
            <p className="text-gray-400">No users found.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-400 mb-4">{filtered.length} user(s) found</p>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-gray-400 text-xs uppercase">
                  <th className="pb-3">Email</th>
                  <th className="pb-3">Current Role</th>
                  <th className="pb-3">Joined</th>
                  <th className="pb-3">Change Role</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr key={user.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-3 font-medium">{user.email}</td>
                    <td className="py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${roleColor[user.role] ?? 'bg-gray-100 text-gray-600'}`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="py-3 text-gray-400">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3">
                      {updating === user.id ? (
                        <span className="text-xs text-gray-400">Updating...</span>
                      ) : (
                        <select
                          value={user.role}
                          onChange={(e) =>
                            updateRole(user.id, e.target.value as 'user' | 'approver' | 'admin')
                          }
                          className="border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                        >
                          <option value="user">User</option>
                          <option value="approver">Approver</option>
                          <option value="admin">Admin</option>
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}