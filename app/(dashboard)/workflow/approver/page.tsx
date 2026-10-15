'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// ─── Styles ──────────────────────────────────────────────────────────────────
const fonts = {
  serif: "font-serif italic",
  mono: "font-mono uppercase tracking-[0.2em] text-[10px]",
};

interface Submission {
  id: string | number;
  tracking_number: string;
  file_name: string;
  file_url: string;
  status: string;
  user_id: string;
  submitter_email?: string;
  created_at: string;
}

// ─── Status Stamp (Synced with User Portal Logic) ──────────────────────────────
function StatusStamp({ status }: { status: string }) {
  const getDisplayConfig = () => {
    switch (status) {
      case 'pending':
      case 'pending_approver':
        return { 
          label: 'PENDING', 
          styles: "text-blue-600 bg-white border-blue-600 shadow-[3px_3px_0px_0px_rgba(37,99,235,0.3)]" 
        };
      case 'pending_admin':
        return { 
          label: 'UNDER REVIEW', 
          styles: "text-white bg-blue-600 border-blue-600 shadow-[3px_3px_0px_0px_rgba(0,0,0,0.2)]" 
        };
      case 'approved':
        return { 
          label: 'APPROVED', 
          styles: "text-blue-700 bg-blue-50 border-blue-400" 
        };
      case 'completed':
        return {
          label: 'COMPLETED',
          styles: "text-green-700 bg-green-50 border-green-400"
        };
      case 'declined_by_approver':
      case 'declined_by_admin':
        return { 
          label: 'REJECTED', 
          styles: "text-red-600 bg-red-50 border-red-600" 
        };
      default:
        return { 
          label: status.toUpperCase().replace('_', ' '), 
          styles: "text-gray-600 bg-gray-50 border-gray-400" 
        };
    }
  };

  const config = getDisplayConfig();

  return (
    <div className={`inline-block px-4 py-1.5 border-2 font-black rotate-[-1deg] ${fonts.mono} ${config.styles}`}>
      {config.label}
    </div>
  );
}

export default function ApproverDashboard() {
  const router = useRouter();
  const supabase = createClient();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  // ─── Data Metrics ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    return {
      pending: submissions.filter(s => s.status === 'pending_approver' || s.status === 'pending').length,
      forwarded: submissions.filter(s => s.status === 'pending_admin').length,
      declined: submissions.filter(s => s.status.includes('declined') || s.status.includes('rejected')).length,
    };
  }, [submissions]);

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("workflow_submissions")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) setSubmissions(data);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchSubmissions(); }, [fetchSubmissions]);

  return (
    <div className="min-h-screen bg-[#fcfcfc] text-gray-900 relative pb-20">
      <div className="max-w-[1100px] mx-auto px-6 py-20">
        
        {/* Header Section */}
        <div className="mb-12 border-b-2 border-gray-900 pb-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h1 className={`${fonts.serif} text-7xl font-light text-gray-900 leading-none`}>Registry</h1>
              <p className={`${fonts.mono} mt-4 text-blue-600`}>Approver_Queue // Stage_01_Verification</p>
            </div>

            <div className="grid grid-cols-3 gap-4 md:w-80">
              <div className="bg-white border-2 border-blue-600 p-3 text-center shadow-[3px_3px_0px_0px_rgba(37,99,235,0.2)]">
                <div className={`${fonts.mono} text-[8px] text-blue-600 mb-1 font-bold`}>Your Queue</div>
                <div className="text-xl font-black text-blue-600 leading-none">{stats.pending}</div>
              </div>
              <div className="bg-blue-600 border-2 border-blue-600 p-3 text-center shadow-[3px_3px_0px_0px_rgba(0,0,0,0.1)]">
                <div className={`${fonts.mono} text-[8px] text-white mb-1 font-bold`}>To Admin</div>
                <div className="text-xl font-black text-white leading-none">{stats.forwarded}</div>
              </div>
              <div className="bg-red-50 border-2 border-red-600 p-3 text-center shadow-[3px_3px_0px_0px_rgba(220,38,38,0.1)]">
                <div className={`${fonts.mono} text-[8px] text-red-600 mb-1 font-bold`}>Declined</div>
                <div className="text-xl font-black text-red-600 leading-none">{stats.declined}</div>
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className={`${fonts.mono} animate-pulse text-blue-600 flex items-center gap-2`}>
            <span className="w-2 h-2 bg-blue-600 rounded-full animate-ping" />
            [ Syncing Submissions ]
          </div>
        ) : (
          <div className="space-y-8">
            {submissions.map((sub) => (
              <article key={sub.id} className="bg-white border-2 border-black p-8 transition-all hover:shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] relative overflow-hidden group">
                {/* Background Watermark */}
                <div className="absolute top-[-10px] right-[-10px] opacity-[0.03] pointer-events-none select-none text-8xl font-black uppercase">
                  {sub.status.split('_')[0]}
                </div>

                <div className="flex flex-col md:flex-row justify-between items-start gap-8 relative z-10">
                  <div className="space-y-4">
                    <div>
                      <div className={`${fonts.mono} text-blue-500 mb-1`}>Tracking: {sub.tracking_number || 'Pending assignment'}</div>
                      <h3 className={`${fonts.serif} text-4xl text-gray-900 group-hover:text-blue-600 transition-colors`}>
                        {sub.file_name || "Untitled_File"}
                      </h3>
                      <p className={`${fonts.mono} text-gray-400 mt-2`}>
                        {sub.submitter_email || 'anonymous_user'} // {new Date(sub.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <StatusStamp status={sub.status} />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                    <button 
                      onClick={() => router.push(`/workflow/approver/file_management/${sub.id}`)}
                      className={`${fonts.mono} bg-blue-600 text-white px-10 py-4 hover:bg-black transition-all font-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none whitespace-nowrap`}
                    >
                      Manage Entry →
                    </button>
                  </div>
                </div>
              </article>
            ))}

            {submissions.length === 0 && (
              <div className="border-4 border-dashed border-gray-100 py-32 text-center">
                <p className={`${fonts.mono} text-gray-300 font-black`}>NO_RECORDS_IN_QUEUE</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}