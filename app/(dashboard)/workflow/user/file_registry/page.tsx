'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

const fonts = {
  serif: "font-serif italic",
  mono: "font-mono uppercase tracking-[0.2em] text-[10px]",
};

const getFileTypeIcon = (fileName: string) => {
  const ext = fileName?.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return '📕';
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'svg': return '🖼️';
    case 'doc':
    case 'docx': return '📘';
    case 'xls':
    case 'xlsx': return '📗';
    default: return '📄';
  }
};

export default function UserFileRegistry() {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const supabase = createClient();

  useEffect(() => {
    async function fetchUserFiles() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('workflow_submissions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (!error) setSubmissions(data || []);
      setLoading(false);
    }
    fetchUserFiles();
  }, [supabase]);

  const filteredSubmissions = submissions.filter(file => {
    const title = file.file_name || '';
    const matchesSearch = title.toLowerCase().includes(searchQuery.toLowerCase());
    
    let matchesFilter = true;
    if (activeFilter === 'PENDING') {
      matchesFilter = file.status.includes('pending'); 
    } else if (activeFilter === 'APPROVED') {
      matchesFilter = file.status === 'approved';
    } else if (activeFilter === 'REJECTED') {
      matchesFilter = file.status.includes('declined') || file.status.includes('rejected');
    }

    return matchesSearch && matchesFilter;
  });

  return (
    <div className="min-h-screen bg-white text-black py-16 px-6">
      <div className="max-w-6xl mx-auto">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-end mb-12 border-b-4 border-blue-600 pb-10 gap-6">
          <div>
            <span className={`${fonts.mono} text-blue-600 font-black`}>User Portal // My Submissions</span>
            <h1 className={`${fonts.serif} text-7xl mt-2 text-black leading-none`}>Files.</h1>
          </div>
          <Link 
            href="/workflow/user/upload"
            className={`${fonts.mono} bg-blue-600 text-white px-10 py-5 hover:bg-blue-700 transition-all shadow-[8px_8px_0px_0px_rgba(37,99,235,0.2)] font-black text-xs active:translate-x-1 active:translate-y-1 active:shadow-none`}
          >
            + Upload New File
          </Link>
        </div>

        {/* TOOLBAR */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-12">
          <div className="lg:col-span-8 relative group">
            <span className="absolute left-6 top-1/2 -translate-y-1/2 text-black font-black font-mono text-[10px] z-10 opacity-30">SEARCH //</span>
            <input 
              type="text"
              placeholder="Find a file by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-blue-50/30 border-2 border-blue-600 focus:bg-white p-5 pl-32 outline-none transition-all font-serif italic text-2xl placeholder:text-blue-200 text-black"
            />
          </div>

          <div className="lg:col-span-4 flex flex-wrap gap-2 content-center">
            {['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`${fonts.mono} flex-1 px-3 py-3 border-2 border-blue-600 transition-all font-black text-[9px] relative
                  ${activeFilter === f 
                    ? 'bg-blue-600 text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)]' 
                    : 'bg-white text-black hover:bg-blue-50'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* FILE LIST */}
        <div className="border-t-2 border-blue-100">
          {loading ? (
            <div className="py-20 flex flex-col items-center">
              <div className="w-12 h-1 bg-blue-600 animate-bounce mb-4"></div>
              <p className={`${fonts.mono} text-blue-600 font-bold`}>Loading your files...</p>
            </div>
          ) : filteredSubmissions.length === 0 ? (
            <div className="border-2 border-dashed border-blue-200 py-32 text-center bg-blue-50/20">
               <p className={`${fonts.mono} text-blue-400 font-black`}>
                 No files found for "{searchQuery || activeFilter}"
               </p>
            </div>
          ) : (
            <div className="divide-y-2 divide-blue-50">
              {filteredSubmissions.map((file) => (
                <div 
                  key={file.id} 
                  className="group py-8 flex flex-col md:flex-row items-center justify-between gap-8 hover:bg-blue-50/30 transition-colors"
                >
                  <div className="flex items-center gap-8 flex-1 w-full">
                    <div className="w-14 h-14 border-2 border-blue-600 flex items-center justify-center text-2xl bg-white shadow-[4px_4px_0px_0px_rgba(37,99,235,0.1)]">
                      {getFileTypeIcon(file.file_name)}
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className={`${fonts.mono} text-[8px] text-blue-600 font-black bg-blue-50 px-2 py-0.5 border border-blue-200`}>
                          {file.category || "General"}
                        </span>
                        <span className={`${fonts.mono} text-[8px] text-black font-bold`}>
                          ID: {file.id.slice(0, 8)}
                        </span>
                      </div>
                      
                      <h3 className="text-3xl font-serif italic font-black text-black group-hover:text-blue-600 transition-colors">
                        {file.file_name}
                      </h3>

                      <div className="flex gap-6 mt-4">
                        <div className="flex flex-col">
                          <span className={`${fonts.mono} text-black font-bold text-[8px]`}>Date Uploaded</span>
                          <span className="font-mono text-[10px] font-bold uppercase text-black">{new Date(file.created_at).toLocaleDateString()}</span>
                        </div>
                        <div className="flex flex-col border-l border-blue-200 pl-6">
                          <span className={`${fonts.mono} text-black font-bold text-[8px]`}>Size</span>
                          <span className="font-mono text-[10px] font-bold uppercase text-black">{(file.file_size / 1024).toFixed(1)} KB</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-10 w-full md:w-auto">
                    <div className="flex flex-col items-end">
                      <span className={`${fonts.mono} text-[8px] font-black mb-2 text-black`}>Current Status</span>
                      <StatusBadge status={file.status} />
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => window.open(file.file_url, '_blank')}
                        className="p-3 border-2 border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white transition-all shadow-[2px_2px_0px_0px_rgba(37,99,235,0.2)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                        title="Quick Preview"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                        </svg>
                      </button>

                      <Link 
                        href={`/workflow/user/file_registry/${file.id}`}
                        className={`${fonts.mono} border-2 border-blue-600 text-blue-600 px-6 py-3 hover:bg-blue-600 hover:text-white transition-all font-black text-[10px] shadow-[4px_4px_0px_0px_rgba(37,99,235,0.2)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none whitespace-nowrap`}
                      >
                        View Details
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const getStatusDisplay = (s: string) => {
    switch (s) {
      case 'pending':
      case 'pending_approver':
        return { label: 'PENDING', styles: "bg-white text-blue-600 border-blue-600 shadow-[2px_2px_0px_0px_rgba(37,99,235,0.3)]" };
      case 'pending_admin':
        return { label: 'UNDER REVIEW', styles: "bg-blue-600 text-white border-blue-600 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.1)]" };
      case 'approved':
        return { label: 'APPROVED', styles: "bg-blue-50 text-blue-700 border-blue-400" };
      case 'declined_by_approver':
      case 'declined_by_admin':
        return { label: 'REJECTED', styles: "bg-red-50 text-red-600 border-red-600" };
      default:
        return { label: s.toUpperCase().replace('_', ' '), styles: "bg-blue-50 text-blue-600 border-blue-200" };
    }
  };

  const { label, styles } = getStatusDisplay(status);

  return (
    <span className={`${fonts.mono} px-4 py-1.5 border-2 font-black text-[9px] whitespace-nowrap ${styles}`}>
      {label}
    </span>
  );
}