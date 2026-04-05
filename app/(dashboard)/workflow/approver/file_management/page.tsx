// app/(dashboard)/workflow/approver/file_management/page.tsx
'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';

const fonts = {
  serif: "font-serif italic",
  mono: "font-mono uppercase tracking-[0.2em] text-[10px]",
};

interface Submission {
  id: string | number;
  file_name: string;
  file_url: string;
  status: string;
  user_id: string;
  created_at: string;
  submitter_email?: string; // We will populate this manually
}

export default function FileManagement() {
  const supabase = createClient();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    
    // 1. Fetch Submissions
    const { data: subs, error: subError } = await supabase
      .from("workflow_submissions")
      .select("*")
      .order("created_at", { ascending: false });

    if (subError) {
      console.error("Submission fetch error:", subError);
      setLoading(false);
      return;
    }

    // 2. Fetch Profiles to get emails
    const { data: profs, error: profError } = await supabase
      .from("profiles")
      .select("id, email");

    if (profError) {
      console.error("Profiles fetch error:", profError);
    }

    // 3. Merge data manually (Failsafe Join)
    const mergedData = subs.map((sub: any) => {
      const userProfile = profs?.find(p => p.id === sub.user_id);
      return {
        ...sub,
        submitter_email: userProfile ? userProfile.email : "Unknown Sender"
      };
    });

    setSubmissions(mergedData);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchSubmissions(); }, [fetchSubmissions]);

  const filteredData = useMemo(() => {
    return submissions.filter((sub) => {
      const email = sub.submitter_email?.toLowerCase() || '';
      const fileName = sub.file_name?.toLowerCase() || '';
      const matchesSearch = 
        fileName.includes(searchTerm.toLowerCase()) ||
        email.includes(searchTerm.toLowerCase()) ||
        String(sub.id).includes(searchTerm);
      
      const matchesStatus = statusFilter === 'all' || sub.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [submissions, searchTerm, statusFilter]);

  const handleDownload = async (url: string, filename: string) => {
    const response = await fetch(url);
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  };

  return (
    <div className="min-h-screen bg-[#fcfcfc] text-gray-900 pb-20">
      <div className="max-w-[1200px] mx-auto px-6 py-20">
        
        <div className="mb-12">
          <h1 className={`${fonts.serif} text-6xl font-light mb-8`}>File Registry</h1>
          
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 border border-gray-200 shadow-sm">
            <div className="relative w-full md:w-96">
              <input 
                type="text"
                placeholder="Search by filename or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`${fonts.mono} w-full border-b-2 border-gray-900 py-2 focus:outline-none focus:border-blue-600 bg-transparent px-2`}
              />
            </div>

            <div className="flex items-center gap-2">
              <span className={`${fonts.mono} text-gray-400 mr-2`}>Filter:</span>
              {['all', 'pending', 'approved', 'declined'].map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`${fonts.mono} px-4 py-2 text-[9px] font-bold border ${
                    statusFilter === status 
                      ? 'bg-blue-600 text-white border-blue-600' 
                      : 'bg-white text-gray-400 border-gray-200 hover:border-gray-900'
                  } transition-all uppercase`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 overflow-hidden shadow-sm rounded-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={`bg-gray-50 border-b border-gray-200 ${fonts.mono} text-gray-500`}>
                  <th className="p-4 font-medium">Log ID</th>
                  <th className="p-4 font-medium">Document Name</th>
                  <th className="p-4 font-medium">Sender Email</th>
                  <th className="p-4 font-medium">Timestamp</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={6} className={`${fonts.mono} p-20 text-center text-blue-600 animate-pulse`}>Accessing Records...</td></tr>
                ) : filteredData.map((sub) => (
                  <tr key={sub.id} className="hover:bg-blue-50/30 transition-colors group">
                    <td className={`${fonts.mono} p-4 text-blue-400 text-[9px]`}>{String(sub.id).slice(0, 8)}</td>
                    <td className="p-4 font-medium text-gray-900">{sub.file_name}</td>
                    <td className="p-4 text-sm text-gray-600 font-semibold">{sub.submitter_email}</td>
                    <td className="p-4 text-sm text-gray-500">
                      {new Date(sub.created_at).toLocaleDateString()}<br/>
                      <span className="text-[10px] opacity-60">{new Date(sub.created_at).toLocaleTimeString()}</span>
                    </td>
                    <td className="p-4">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                        sub.status === 'approved' ? 'bg-green-100 text-green-700' :
                        sub.status === 'declined' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {sub.status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setPreviewFile({ url: sub.file_url, name: sub.file_name })} className="p-2 hover:text-blue-600 transition-colors">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>
                        <button onClick={() => handleDownload(sub.file_url, sub.file_name)} className="p-2 hover:text-gray-900 text-gray-400">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {filteredData.length === 0 && !loading && (
            <div className={`${fonts.serif} p-20 text-center text-gray-300 text-2xl`}>
              No matching files found in the registry.
            </div>
          )}
        </div>
      </div>

      {previewFile && (
        <div className="fixed inset-0 bg-black/95 z-[100] flex flex-col">
          <div className="px-6 py-4 flex justify-between items-center border-b border-white/10 bg-black">
            <h2 className="text-white text-lg font-medium">{previewFile.name}</h2>
            <button onClick={() => setPreviewFile(null)} className="text-white text-3xl hover:text-blue-500">×</button>
          </div>
          <iframe className="flex-1 w-full bg-white" src={`https://docs.google.com/gview?url=${encodeURIComponent(previewFile.url)}&embedded=true`} />
        </div>
      )}
    </div>
  );
}