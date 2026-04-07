// src/app/(dashboard)/workflow/admin/user_management/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

const fonts = {
  serif: "font-serif italic",
  mono: "font-mono uppercase tracking-[0.15em] text-[10px]",
};

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
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [updating, setUpdating] = useState<string | null>(null);

  // --- DATA ACTIONS ---

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

  const deleteUser = async (userId: string, email: string) => {
    const confirmed = window.confirm(
      `WARNING: Are you sure you want to delete ${email}? This will remove their profile record.`
    );
    
    if (!confirmed) return;

    setUpdating(userId);
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (error) {
      console.error('Delete error:', error.message);
      alert('Failed to delete user profile.');
    }

    setUpdating(null);
    fetchUsers();
  };

  // --- LIFECYCLE ---

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

  // --- FILTERING ---

  const filtered = users.filter((u) => {
    const matchesSearch = u.email.toLowerCase().includes(search.toLowerCase());
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const roleStyles: Record<string, string> = {
    admin: 'border-blue-600 text-blue-600 bg-blue-50',
    approver: 'border-purple-600 text-purple-600 bg-purple-50',
    user: 'border-gray-400 text-gray-500 bg-gray-50',
  };

  return (
    <div className="space-y-10 pb-20">
      {/* Header Section */}
      <div className="border-b-4 border-gray-900 pb-8">
        <h1 className={`${fonts.serif} text-7xl font-light text-gray-900 leading-none tracking-tight`}>
          User Management
        </h1>
        <div className="flex items-center justify-between mt-4">
          <p className={`${fonts.mono} text-blue-600 font-bold`}>
            System Access Control
          </p>
          <p className={`${fonts.mono} text-gray-400 font-bold`}>
            Total Users: {users.length}
          </p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1 max-w-md">
          <label className={`${fonts.mono} block mb-2 font-bold text-gray-900`}>Search By Email</label>
          <input
            type="text"
            placeholder="Enter email address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white border-2 border-gray-900 p-4 font-medium text-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] focus:shadow-none focus:translate-x-1 focus:translate-y-1 transition-all outline-none"
          />
        </div>

        <div className="w-full md:w-48">
          <label className={`${fonts.mono} block mb-2 font-bold text-gray-900`}>Filter Role</label>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="w-full bg-white border-2 border-gray-900 p-4 font-bold text-xs shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] focus:shadow-none focus:translate-x-1 focus:translate-y-1 transition-all cursor-pointer uppercase"
          >
            <option value="all">All Roles</option>
            <option value="admin">Admin</option>
            <option value="approver">Approver</option>
            <option value="user">User</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white border-2 border-gray-900 shadow-[10px_10px_0px_0px_rgba(37,99,235,0.1)] overflow-hidden">
        <div className="p-4 border-b-2 border-gray-900 bg-gray-50 flex items-center justify-between">
          <h2 className={`${fonts.mono} font-black text-gray-900`}>User Directory</h2>
          <div className="flex items-center gap-2">
            {loading && <span className={`${fonts.mono} text-blue-600 animate-pulse`}>Loading...</span>}
            <div className="w-2 h-2 bg-blue-900 rounded-full animate-pulse" />
          </div>
        </div>

        <div className="overflow-x-auto">
          {filtered.length === 0 && !loading ? (
            <div className="py-20 text-center border-b-2 border-gray-900">
              <p className="font-medium text-gray-400 italic">No users match your criteria.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={`${fonts.mono} bg-gray-900 text-white`}>
                  <th className="p-5 font-bold">User Details</th>
                  <th className="p-5 font-bold text-center">Current Role</th>
                  <th className="p-5 font-bold">Date Joined</th>
                  <th className="p-5 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-gray-900">
                {filtered.map((user) => (
                  <tr key={user.id} className="hover:bg-blue-50/30 transition-colors">
                    <td className="p-5">
                      <div className="font-bold text-gray-900">{user.email}</div>
                      <div className="text-[10px] font-mono text-gray-400 mt-0.5">ID: {user.id.slice(0, 8)}</div>
                    </td>
                    <td className="p-5 text-center">
                      <span className={`inline-block border-2 px-3 py-0.5 ${fonts.mono} font-black text-[9px] shadow-[2px_2px_0px_0px_currentColor] uppercase ${roleStyles[user.role]}`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="p-5">
                      <div className="text-sm text-gray-600 font-medium">
                        {new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                      </div>
                    </td>
                    <td className="p-5 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {updating === user.id ? (
                          <div className="text-xs font-bold text-blue-600 animate-pulse uppercase">Processing...</div>
                        ) : (
                          <>
                            <select
                              value={user.role}
                              onChange={(e) => updateRole(user.id, e.target.value as 'user' | 'approver' | 'admin')}
                              className="bg-white border-2 border-gray-900 px-3 py-1 font-bold text-[11px] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 transition-all cursor-pointer outline-none uppercase"
                            >
                              <option value="user">User</option>
                              <option value="approver">Approver</option>
                              <option value="admin">Admin</option>
                            </select>

                            <button
                              onClick={() => deleteUser(user.id, user.email)}
                              className="bg-red-50 text-red-600 border-2 border-red-600 px-3 py-1 font-bold text-[11px] shadow-[3px_3px_0px_0px_rgba(220,38,38,1)] hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 transition-all cursor-pointer uppercase"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}