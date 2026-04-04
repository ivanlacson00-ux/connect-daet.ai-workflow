// src/app/(subsystems)/workflow/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Submission {
  id: string;
  file_name: string;
  file_url: string;
  file_size: number;
  status: string;
  approver_comments: string;
  admin_comments: string;
  created_at: string;
}

export default function WorkflowDashboard() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const supabase = createClient();

  useEffect(() => {
    fetchUserAndSubmissions();
  }, []);

  const fetchUserAndSubmissions = async () => {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    setUser(user);

    if (user) {
      // Fetch user's submissions
      const { data, error } = await supabase
        .from('workflow_submissions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setSubmissions(data);
      }
    }

    setLoading(false);
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; color: string }> = {
      pending_approver: { label: 'Pending Approver', color: 'bg-yellow-500' },
      pending_admin: { label: 'Pending Admin', color: 'bg-blue-500' },
      approved: { label: 'Approved ✓', color: 'bg-green-500' },
      declined_by_approver: { label: 'Declined by Approver', color: 'bg-red-600' },
      declined_by_admin: { label: 'Declined by Admin', color: 'bg-red-600' },
    };

    const config = statusConfig[status] || statusConfig.pending_approver;
    return (
      <span className={`${config.color} rounded-full px-3 py-1 text-sm text-white`}>
        {config.label}
      </span>
    );
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return <div className="text-center py-8">Loading your submissions...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">My Submissions</h2>
        <a
          href="/workflow/user/upload"
          className="rounded-full bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 transition-colors"
        >
          + New Upload
        </a>
      </div>

      {submissions.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-2xl">
          <p className="text-gray-500 mb-4">No submissions yet</p>
          <a
            href="/workflow/user/upload"
            className="rounded-full bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
          >
            Upload your first file
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          {submissions.map((sub) => (
            <div
              key={sub.id}
              className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">
                      {sub.file_name.match(/\.(jpg|jpeg|png|gif)$/i) ? '🖼️' :
                       sub.file_name.match(/\.(pdf)$/i) ? '📄' :
                       sub.file_name.match(/\.(mp4|mov|avi)$/i) ? '🎥' :
                       '📎'}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg break-all">{sub.file_name}</h3>
                      <p className="text-sm text-gray-500">
                        {formatFileSize(sub.file_size)} • {formatDate(sub.created_at)}
                      </p>
                      <div className="mt-2">
                        {getStatusBadge(sub.status)}
                      </div>
                      
                      {/* Show rejection reason if declined */}
                      {(sub.status === 'declined_by_approver' && sub.approver_comments) && (
                        <div className="mt-2 p-2 bg-red-50 rounded-lg text-sm text-red-700">
                          <strong>Approver said:</strong> {sub.approver_comments}
                        </div>
                      )}
                      {(sub.status === 'declined_by_admin' && sub.admin_comments) && (
                        <div className="mt-2 p-2 bg-red-50 rounded-lg text-sm text-red-700">
                          <strong>Admin said:</strong> {sub.admin_comments}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <a
                    href={sub.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 transition-colors"
                  >
                    View File
                  </a>
                  
                  {(sub.status === 'declined_by_approver' || sub.status === 'declined_by_admin') && (
                    <a
                      href="/workflow/user/upload"
                      className="rounded-full bg-blue-100 px-4 py-2 text-sm text-blue-700 hover:bg-blue-200 transition-colors"
                    >
                      Resubmit
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}