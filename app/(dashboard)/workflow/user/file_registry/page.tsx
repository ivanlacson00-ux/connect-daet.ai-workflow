'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

const fonts = {
  serif: "font-serif italic",
  mono: "font-mono uppercase tracking-[0.2em] text-[10px]",
};

export default function UserFileRegistry() {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState(''); // Search State
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

  // COMBINED LOGIC: Filter + Search
  const filteredSubmissions = submissions.filter(file => {
    const matchesSearch = file.file_name.toLowerCase().includes(searchQuery.toLowerCase());
    
    let matchesFilter = true;
    if (activeFilter === 'PENDING') {
      // Catches default pending, pending_approver, and pending_admin
      matchesFilter = file.status.includes('pending'); 
    } else if (activeFilter === 'APPROVED') {
      matchesFilter = file.status === 'approved';
    } else if (activeFilter === 'REJECTED') {
      matchesFilter = file.status.includes('declined');
    }

    return matchesSearch && matchesFilter;
  });

  return (
    <div className="min-h-screen bg-[#fcfcfc] text-black py-16 px-6">
      <div className="max-w-5xl mx-auto">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-end mb-12 border-b-2 border-blue-600 pb-8 gap-6">
          <div>
            <span className={`${fonts.mono} text-blue-600 font-bold`}>User_Access // Personal_Archive</span>
            <h1 className={`${fonts.serif} text-6xl mt-2 text-black`}>Your Submissions</h1>
          </div>
          <Link 
            href="/workflow/user/upload"
            className={`${fonts.mono} bg-blue-600 text-white px-8 py-4 hover:bg-black transition-all shadow-[6px_6px_0px_0px_rgba(37,99,235,0.2)] font-bold`}
          >
            + New_Submission
          </Link>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="space-y-6 mb-12">
          {/* Search Input */}
          <div className="relative group">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-600 font-bold font-mono text-[12px]">SEARCH_</span>
            <input 
              type="text"
              placeholder="Enter Document Title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white border-2 border-blue-100 focus:border-blue-600 p-4 pl-20 outline-none transition-all font-serif italic text-xl placeholder:text-gray-200"
            />
          </div>

          {/* Filter Segmented Control */}
          <div className="flex flex-wrap gap-3">
            {['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`${fonts.mono} px-4 py-2 border-2 transition-all font-black flex items-center gap-2
                  ${activeFilter === f 
                    ? 'bg-blue-600 border-blue-600 text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]' 
                    : 'bg-white border-blue-100 text-blue-600 hover:border-blue-600'}`}
              >
                {f} 
                <span className={`text-[8px] opacity-60 px-1 ${activeFilter === f ? 'bg-white/20' : 'bg-blue-50'}`}>
                  {submissions.filter(s => {
                    if (f === 'ALL') return true;
                    if (f === 'PENDING') return s.status.includes('pending');
                    if (f === 'APPROVED') return s.status === 'approved';
                    if (f === 'REJECTED') return s.status.includes('declined');
                    return true;
                  }).length}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* The Ledger List */}
        <div className="space-y-4">
          {loading ? (
            <p className={`${fonts.mono} animate-pulse text-blue-600 font-bold`}>Syncing_Database...</p>
          ) : filteredSubmissions.length === 0 ? (
            <div className="border-2 border-dashed border-blue-200 py-20 text-center bg-gray-50/50">
               <p className={`${fonts.mono} text-blue-400 font-bold`}>
                 No_Results_Found [ Search: "{searchQuery || activeFilter}" ]
               </p>
            </div>
          ) : (
            filteredSubmissions.map((file) => (
              <div 
                key={file.id} 
                className="group bg-white border-2 border-blue-100 hover:border-blue-600 transition-all p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm hover:shadow-md"
              >
                <div className="flex items-start gap-6 flex-1">
                  <div className="w-14 h-14 bg-blue-50 border border-blue-100 flex items-center justify-center text-2xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
                    📄
                  </div>
                  <div>
                    <h3 className="text-xl font-serif italic font-bold text-black">{file.file_name}</h3>
                    <div className="mt-1">
                      <span className={`${fonts.mono} bg-blue-50 text-blue-700 px-2 py-0.5 font-bold border border-blue-100 inline-block`}>
                        Dept: {file.category || "General"}
                      </span>
                    </div>
                    <div className="flex gap-4 mt-3">
                      <span className={`${fonts.mono} text-[9px] font-bold text-black opacity-60 uppercase tracking-tighter`}>
                        Vault_ID: {file.id.slice(0, 8)}
                      </span>
                      <span className={`${fonts.mono} text-[9px] font-bold text-black border-l border-blue-100 pl-4 opacity-60`}>
                        Logged: {new Date(file.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-8 w-full md:w-auto border-t border-blue-50 md:border-t-0 pt-4 md:pt-0">
                  <div className="flex flex-col items-end flex-1 md:flex-none">
                    <span className={`${fonts.mono} text-[8px] font-black mb-1 text-blue-600`}>Status_Report</span>
                    <StatusBadge status={file.status} />
                  </div>
                  <div className="flex gap-2">
                    <Link 
                      href={`/workflow/user/view/${file.id}`}
                      className={`${fonts.mono} border-2 border-blue-600 px-4 py-2 hover:bg-blue-600 hover:text-white transition-all font-bold text-blue-600`}
                    >
                      [ View ]
                    </Link>
                  </div>
                </div>
              </div>
            ))
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
        return { label: 'PENDING', styles: "bg-orange-50 text-orange-600 border-orange-200" };
      case 'pending_admin':
        return { label: 'AWAITING FINAL REVIEW', styles: "bg-blue-50 text-blue-600 border-blue-200" };
      case 'approved':
        return { label: 'APPROVED', styles: "bg-green-50 text-green-600 border-green-200" };
      case 'declined_by_approver':
      case 'declined_by_admin':
        return { label: 'REJECTED', styles: "bg-red-50 text-red-600 border-red-200" };
      default:
        return { label: s.toUpperCase(), styles: "bg-gray-50 text-gray-600 border-gray-200" };
    }
  };

  const { label, styles } = getStatusDisplay(status);

  return (
    <span className={`${fonts.mono} px-3 py-1 border font-black text-[9px] whitespace-nowrap ${styles}`}>
      {label}
    </span>
  );
}