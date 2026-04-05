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
  submitter_email?: string;
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
    const { data: subs, error: subError } = await supabase
      .from("workflow_submissions")
      .select("*")
      .order("created_at", { ascending: false });

    if (subError) {
      setLoading(false);
      return;
    }

    const { data: profs } = await supabase.from("profiles").select("id, email");

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
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.download = filename;
      link.click();
    } catch (e) {
      console.error("Download error", e);
    }
  };

  // HELPER: Check if file is an image
  const isImage = (fileName: string) => {
    return /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(fileName);
  };

  return (
    <div className="min-h-screen bg-[#fcfcfc] text-gray-900 pb-20">
      <div className="max-w-[1100px] mx-auto px-6 py-12">
        
        {/* Header Section */}
        <div className="mb-12 border-b-2 border-gray-900 pb-10">
          <h1 className={`${fonts.serif} text-6xl font-light text-gray-900 leading-none`}>File Registry</h1>
          <p className={`${fonts.mono} mt-4 text-blue-600`}>Central Document Archive // Archive Access</p>
        </div>

        {/* Controls Bar */}
        <div className="flex flex-col lg:flex-row gap-6 mb-10 items-end justify-between bg-white border-2 border-gray-900 p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
          <div className="w-full lg:w-96">
            <label className={`${fonts.mono} text-blue-400 block mb-2`}>Search_Database</label>
            <input 
              type="text"
              placeholder="Filename, email, or ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full border-b-2 border-gray-900 py-2 focus:outline-none focus:border-blue-600 bg-transparent text-sm font-bold placeholder:text-gray-300"
            />
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            {['all', 'pending', 'approved', 'declined'].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`${fonts.mono} px-4 py-2 border-2 transition-all ${
                  statusFilter === status 
                    ? 'bg-blue-600 text-white border-blue-600 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]' 
                    : 'bg-white text-gray-400 border-gray-200 hover:border-gray-900 hover:text-gray-900'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Table Container */}
        <div className="bg-white border-2 border-gray-900 shadow-[10px_10px_0px_0px_rgba(37,99,235,0.1)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={`bg-gray-900 text-white ${fonts.mono}`}>
                  <th className="p-5 font-bold tracking-widest">Entry_ID</th>
                  <th className="p-5 font-bold tracking-widest">Document</th>
                  <th className="p-5 font-bold tracking-widest">Origin</th>
                  <th className="p-5 font-bold tracking-widest">Status</th>
                  <th className="p-5 font-bold tracking-widest text-right">Utility</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-gray-900">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="p-24 text-center">
                      <div className={`${fonts.mono} animate-pulse text-blue-600 text-lg`}>[ Synchronizing_Records... ]</div>
                    </td>
                  </tr>
                ) : filteredData.map((sub) => (
                  <tr key={sub.id} className="hover:bg-blue-50/50 transition-colors group">
                    <td className={`${fonts.mono} p-5 text-blue-500 font-bold`}>#{String(sub.id).slice(0, 6)}</td>
                    <td className="p-5">
                      <div className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors">{sub.file_name}</div>
                      <div className={`${fonts.mono} text-[8px] text-gray-400 mt-1`}>
                        Logged: {new Date(sub.created_at).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="p-5">
                      <div className="text-xs font-black text-gray-700">{sub.submitter_email}</div>
                    </td>
                    <td className="p-5">
                      <div className={`inline-block px-3 py-0.5 border-2 ${fonts.mono} font-black text-[9px] shadow-[2px_2px_0px_0px_currentColor] ${
                        sub.status === 'approved' ? 'border-green-600 text-green-600 bg-green-50' :
                        sub.status === 'declined' ? 'border-red-600 text-red-600 bg-red-50' : 'border-orange-500 text-orange-500 bg-orange-50'
                      }`}>
                        {sub.status}
                      </div>
                    </td>
                    <td className="p-5 text-right">
                      <div className="flex justify-end gap-3">
                        <button 
                          onClick={() => setPreviewFile({ url: sub.file_url, name: sub.file_name })} 
                          className="p-2 border border-gray-200 hover:border-blue-600 hover:text-blue-600 transition-all bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,0.05)] hover:shadow-none"
                          title="Preview"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>
                        <button 
                          onClick={() => handleDownload(sub.file_url, sub.file_name)} 
                          className="p-2 border border-gray-200 hover:border-gray-900 text-gray-400 hover:text-gray-900 transition-all bg-white"
                          title="Download"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {filteredData.length === 0 && !loading && (
            <div className="p-24 text-center border-t-2 border-gray-900 bg-gray-50/50">
              <p className={`${fonts.serif} text-2xl text-gray-300`}>No matches found in Registry Archive.</p>
            </div>
          )}
        </div>
      </div>

      {/* Preview Modal - UPDATED TO HANDLE IMAGES */}
      {previewFile && (
        <div className="fixed inset-0 bg-black/95 z-[100] flex flex-col animate-in fade-in duration-300">
          <div className="px-6 py-4 flex justify-between items-center border-b-2 border-white/10 bg-black">
            <div className="flex flex-col">
              <span className={`${fonts.mono} text-blue-500 mb-0.5`}>Vault_Registry_Preview</span>
              <h2 className="text-white text-lg font-medium">{previewFile.name}</h2>
            </div>
            <button 
              onClick={() => setPreviewFile(null)} 
              className="text-white hover:text-red-500 transition-all p-2"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          
          <div className="flex-1 w-full flex items-center justify-center overflow-hidden bg-[#1a1a1a]">
            {isImage(previewFile.name) ? (
              <img 
                src={previewFile.url} 
                alt={previewFile.name} 
                className="max-w-full max-h-full object-contain p-8 animate-in zoom-in-95 duration-300"
              />
            ) : (
              <iframe 
                className="w-full h-full border-none bg-white" 
                src={`https://docs.google.com/gview?url=${encodeURIComponent(previewFile.url)}&embedded=true`} 
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}