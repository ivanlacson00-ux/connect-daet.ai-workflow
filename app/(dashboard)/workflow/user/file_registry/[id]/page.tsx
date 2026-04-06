'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const fonts = {
  serif: "font-serif italic",
  mono: "font-mono uppercase tracking-[0.2em] text-[10px]",
};

interface Submission {
  id: string;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  status: string;
  approver_comments: string;
  admin_comments: string;
  created_at: string;
}

export default function UserFileDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [sub, setSub] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const fetchSubmission = async () => {
      const { data, error } = await supabase
        .from('workflow_submissions')
        .select('*')
        .eq('id', id)
        .single();

      if (data) setSub(data);
      setLoading(false);
    };
    fetchSubmission();
  }, [id, supabase]);

  const isImage = (type: string) => type?.startsWith('image/');

  if (loading) return <div className={`${fonts.mono} p-20 animate-pulse text-blue-600`}>Accessing_Archive...</div>;
  if (!sub) return <div className="p-20 font-serif text-2xl">File not found in registry.</div>;

  return (
    <div className="min-h-screen bg-[#fcfcfc] pb-20">
      {/* Header Navigation */}
      <div className="flex justify-between items-center border-b-2 border-black pb-6 mb-12">
        <div>
          <button 
            onClick={() => router.back()}
            className={`${fonts.mono} text-blue-600 hover:text-black transition-colors font-bold`}
          >
            ← Back_to_Archive
          </button>
          <h1 className={`${fonts.serif} text-5xl mt-4 text-black`}>{sub.file_name}</h1>
        </div>
        
        <div className="text-right">
          <p className={`${fonts.mono} text-gray-400`}>Status_Report</p>
          <span className={`inline-block mt-2 px-4 py-1 border-2 border-current font-black ${fonts.mono}
            ${sub.status === 'approved' ? 'text-green-600' : sub.status.includes('reject') ? 'text-red-600' : 'text-orange-600'}`}>
            {sub.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Main Viewer Column */}
        <div className="lg:col-span-8 space-y-8">
          <div className="bg-white border-2 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,0.05)] overflow-hidden">
            <div className="bg-black p-3 flex justify-between items-center">
              <span className={`${fonts.mono} text-white text-[9px]`}>Media_Output // Render_Mode</span>
              <a 
                href={sub.file_url} 
                target="_blank" 
                rel="noreferrer"
                className={`${fonts.mono} text-blue-400 hover:text-white text-[9px] underline`}
              >
                Open_Source_External
              </a>
            </div>
            
            <div className="bg-[#1a1a1a] flex items-center justify-center min-h-[500px]">
              {isImage(sub.file_type) ? (
                <img 
                  src={sub.file_url} 
                  alt={sub.file_name} 
                  className="max-w-full h-auto p-4 animate-in fade-in duration-500"
                />
              ) : (
                <iframe 
                  title="Document Preview"
                  className="w-full h-[600px] border-none bg-white" 
                  src={`https://docs.google.com/gview?url=${encodeURIComponent(sub.file_url)}&embedded=true`} 
                />
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Info Column */}
        <div className="lg:col-span-4 space-y-6">
          <section className="p-6 border-2 border-black bg-white">
            <h3 className={`${fonts.mono} text-blue-600 mb-4 font-bold`}>Metadata_Index</h3>
            <div className="space-y-4">
              <div>
                <p className={`${fonts.mono} text-gray-400`}>Mime_Type</p>
                <p className="font-mono text-sm uppercase">{sub.file_type}</p>
              </div>
              <div>
                <p className={`${fonts.mono} text-gray-400`}>Size_Allocated</p>
                <p className="font-mono text-sm">{(sub.file_size / 1024).toFixed(2)} KB</p>
              </div>
              <div>
                <p className={`${fonts.mono} text-gray-400`}>Log_Date</p>
                <p className="font-mono text-sm">{new Date(sub.created_at).toLocaleString()}</p>
              </div>
              <div>
                <p className={`${fonts.mono} text-gray-400`}>Object_ID</p>
                <p className="font-mono text-[10px] break-all text-gray-500">{sub.id}</p>
              </div>
            </div>
          </section>

          {/* Feedback Section (Only shows if there is feedback) */}
          {(sub.approver_comments || sub.admin_comments) && (
            <section className="p-6 border-2 border-red-600 bg-red-50">
              <h3 className={`${fonts.mono} text-red-600 mb-2 font-bold`}>Official_Feedback</h3>
              <p className="font-serif italic text-lg text-red-900">
                "{sub.admin_comments || sub.approver_comments}"
              </p>
              <p className={`${fonts.mono} mt-4 text-[9px] text-red-400`}>
                Source: {sub.admin_comments ? 'ADMIN_OFFICE' : 'APPROVER_GATE'}
              </p>
            </section>
          )}

          <div className="pt-6">
            <button 
              onClick={() => window.open(sub.file_url, '_blank')}
              className={`${fonts.mono} w-full py-4 bg-black text-white hover:bg-blue-600 transition-all shadow-[6px_6px_0px_0px_rgba(37,99,235,1)] active:translate-x-1 active:translate-y-1 active:shadow-none`}
            >
              Download_Original_Manifest
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}