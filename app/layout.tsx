// app/(dashboard)/workflow/layout.tsx
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function WorkflowLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [role, setRole] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const supabase = createClient();

  useEffect(() => {
    const getUserInfo = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserEmail(user.email || null);
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();
        setRole(profile?.role || 'user');
      }
    };
    getUserInfo();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const navLinks = () => {
    if (role === 'user') {
      return [
        { href: '/workflow/user', label: 'Dashboard', icon: '🏠' },
        { href: '/workflow/user/upload', label: 'Upload Submission', icon: '📤' },
      ];
    }
    if (role === 'approver') {
      return [
        { href: '/workflow/approver', label: 'Pending Reviews', icon: '⏳' },
        { href: '/workflow/approver/history', label: 'Review History', icon: '📜' },
      ];
    }
    if (role === 'admin') {
      return [
        { href: '/workflow/admin', label: 'Admin Overview', icon: '📊' },
        { href: '/workflow/admin/pending', label: 'Pending My Review', icon: '⏳' },
        { href: '/workflow/admin/submissions', label: 'All Submissions', icon: '📁' },
        // Fixed: Matching folder name "user_management" to prevent 404
        { href: '/workflow/admin/user_management', label: 'User Management', icon: '👥' },
      ];
    }
    return [];
  };

  // Improved isActive to handle sub-paths
  const isActive = (path: string) => pathname === path;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile menu button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 bg-blue-600 text-white p-2 rounded-lg shadow-lg"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Sidebar */}
      <div className={`
        fixed top-0 left-0 h-full bg-white border-r border-gray-200 z-40
        transition-transform duration-300 w-64 lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Logo */}
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-xl font-bold text-blue-600 tracking-tight">📁 Workflow Portal</h1>
        </div>

        {/* User Info Card */}
        <div className="p-4 border-b border-gray-200 bg-blue-50/50">
          <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Logged in as</p>
          <p className="font-medium text-gray-900 truncate text-sm">{userEmail || 'Loading...'}</p>
          {role && (
            <span className="inline-block mt-1.5 px-2 py-0.5 bg-blue-600 text-white text-[10px] rounded font-black uppercase tracking-tighter">
              {role}
            </span>
          )}
        </div>

        {/* Nav Links */}
        <nav className="p-4 space-y-1">
          {navLinks().map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setSidebarOpen(false)}
              className={`
                flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-semibold
                ${isActive(link.href) 
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' 
                  : 'text-gray-500 hover:bg-blue-50 hover:text-blue-600'
                }
              `}
            >
              <span className="text-lg">{link.icon}</span>
              <span>{link.label}</span>
            </Link>
          ))}
        </nav>

        {/* Logout Button */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-100 bg-white">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-500 hover:bg-red-50 transition-colors text-sm font-bold"
          >
            <span className="text-xl">🚪</span>
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-30 lg:hidden" 
          onClick={() => setSidebarOpen(false)} 
        />
      )}

      {/* Main Content Area */}
      <main className="lg:ml-64 min-h-screen">
        <div className="max-w-7xl mx-auto px-6 py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
