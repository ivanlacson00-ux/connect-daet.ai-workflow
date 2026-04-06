'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const fonts = {
  mono: "font-mono uppercase tracking-[0.2em] text-[10px]",
  serif: "font-serif italic",
};

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
  }, [supabase]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const navLinks = () => {
    // --- USER NAVIGATION ---
    if (role === 'user') {
      return [
        { href: '/workflow/user', label: 'Dashboard', icon: '◰' },
        { href: '/workflow/user/upload', label: 'Upload', icon: '⊕' },
        { href: '/workflow/user/file_registry', label: 'File Registry', icon: '▤' }, // ADDED THIS
      ];
    }
    // --- APPROVER NAVIGATION ---
    if (role === 'approver') {
      return [
        { href: '/workflow/approver', label: 'Dashboard', icon: '⎚' },
        { href: '/workflow/approver/file_management', label: 'File Registry', icon: '▤' },
      ];
    }
    // --- ADMIN NAVIGATION ---
    if (role === 'admin') {
      return [
        { href: '/workflow/admin', label: 'Dashboard', icon: '⌬' },
        { href: '/workflow/admin/user_management', label: 'User Registry', icon: '☍' },
        { href: '/workflow/admin/submissions', label: 'File Submissions', icon: '▤' },
      ];
    }
    return [];
  };

  // Helper to check if the current link is active
  const isActive = (path: string) => pathname === path;

  return (
    <div className="min-h-screen bg-[#fcfcfc] text-gray-900">
      {/* Mobile Trigger */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="lg:hidden fixed top-4 right-4 z-50 bg-black text-white w-10 h-10 flex items-center justify-center border-2 border-black active:bg-blue-600 transition-colors"
      >
        {sidebarOpen ? '✕' : '☰'}
      </button>

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 h-full bg-white border-r-2 border-gray-900 z-40
        transition-transform duration-300 w-60 lg:translate-x-0
        flex flex-col
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        
        {/* Brand Header */}
        <div className="p-6 border-b-2 border-gray-900 bg-white">
          <h1 className={`${fonts.serif} text-2xl font-light`}>Portal.</h1>
          <p className={`${fonts.mono} text-blue-600 mt-1`}>Verified Access</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          <div className={`${fonts.mono} text-gray-300 px-2 mb-2 scale-90 origin-left opacity-70`}>Navigation</div>
          {navLinks().map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setSidebarOpen(false)}
                className={`
                  group flex items-center gap-3 px-3 py-3 transition-all duration-150
                  ${active 
                    ? 'bg-blue-600 text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]' 
                    : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50'
                  }
                `}
              >
                <span className="text-lg">{link.icon}</span>
                <span className={`${fonts.mono} font-bold leading-none ${active ? 'text-white' : 'text-gray-900'}`}>
                  {link.label}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* User Panel */}
        <div className="mt-auto border-t-2 border-gray-900 bg-gray-50">
          <div className="p-5 border-b border-gray-200">
            <div className={`${fonts.mono} text-gray-400 mb-1 scale-90 origin-left`}>Auth_ID</div>
            <p className="font-bold text-[11px] truncate mb-2 text-gray-700">{userEmail || 'ID_LOADING...'}</p>
            <div className="inline-block border border-blue-600 px-2 py-0.5 text-blue-600 font-black text-[8px] tracking-widest uppercase bg-white shadow-[1.5px_1.5px_0px_0px_currentColor]">
              {role || 'validating'}
            </div>
          </div>
          
          <div className="p-4">
            <button
              onClick={handleLogout}
              className={`${fonts.mono} w-full flex items-center justify-center gap-2 py-3 bg-white border border-red-600 text-red-600 hover:bg-red-600 hover:text-white transition-all font-black text-[9px] shadow-[3px_3px_0px_0px_rgba(0,0,0,0.05)] hover:shadow-none`}
            >
              <span>[ Log out ]</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-30 lg:hidden" 
          onClick={() => setSidebarOpen(false)} 
        />
      )}

      {/* Main Content Area */}
      <main className="lg:ml-60 min-h-screen">
        <div className="max-w-[1000px] mx-auto px-6 py-10">
          {children}
        </div>
        
        <div className="fixed bottom-6 right-6 pointer-events-none opacity-[0.02] select-none">
          <h1 className="text-8xl font-black italic uppercase leading-none">CONNECT</h1>
        </div>
      </main>
    </div>
  );
}