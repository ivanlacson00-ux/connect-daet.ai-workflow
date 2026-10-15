'use client';

import { useState } from 'react';
import { useSubmissions } from '@/hooks/useSubmissions';

export default function PendingPage() {
  const { submissions, loading, adminApprove, adminDecline } = useSubmissions('pending_admin');
  const [declineModal, setDeclineModal] = useState<{ id: string } | null>(null);
  const [declineComment, setDeclineComment] = useState('');

  const statusColor: Record<string, string> = {
    pending:              'bg-yellow-100 text-yellow-700',
    pending_approver:     'bg-yellow-100 text-yellow-700',
    pending_admin:        'bg-orange-100 text-orange-700',
    approved:             'bg-green-100 text-green-700',
    declined_by_approver: 'bg-red-100 text-red-500',
    declined_by_admin:    'bg-red-200 text-red-700',
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">My Pending Reviews</h1>
        <p className="text-sm text-gray-500 mt-1">
          Submissions approved by approver, waiting for your final decision
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow p-6">
        {loading ? (
          <p className="text-gray-400">Loading submissions...</p>
        ) : submissions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400">No pending submissions for your review.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-gray-400 text-xs uppercase">
                <th className="pb-3">File</th>
                <th className="pb-3">Uploaded By</th>
                <th className="pb-3">Type</th>
                <th className="pb-3">Date</th>
                <th className="pb-3">Status</th>
                <th className="pb-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((sub) => (
                <tr key={sub.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-3">
                    <span
                      onClick={() => window.open(`/api/workflow/files/${sub.id}?redirect=1`, '_blank')}
                      className="text-blue-600 underline font-medium cursor-pointer"
                    >
                      {sub.file_name}
                    </span>
                  </td>
                  <td className="py-3 text-gray-500">{sub.profiles?.email ?? '—'}</td>
                  <td className="py-3 text-gray-400 uppercase text-xs">{sub.file_type}</td>
                  <td className="py-3 text-gray-400">
                    {new Date(sub.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[sub.status]}`}>
                      {sub.status === 'pending_admin' ? 'PENDING APPROVAL' : sub.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => adminApprove(sub.id)}
                        className="px-3 py-1 bg-green-500 text-white text-xs rounded-full hover:bg-green-600"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => setDeclineModal({ id: sub.id })}
                        className="px-3 py-1 bg-red-500 text-white text-xs rounded-full hover:bg-red-600"
                      >
                        Decline
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {declineModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold mb-2">Decline Submission</h3>
            <p className="text-sm text-gray-500 mb-4">Please provide a reason for declining.</p>
            <textarea
              value={declineComment}
              onChange={(e) => setDeclineComment(e.target.value)}
              placeholder="Enter rejection reason..."
              className="w-full border rounded-lg p-3 text-sm mb-4 h-28 resize-none focus:outline-none focus:ring-2 focus:ring-red-400"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setDeclineModal(null); setDeclineComment(''); }}
                className="px-4 py-2 text-sm border rounded-full hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!declineComment.trim()) return;
                  await adminDecline(declineModal.id, declineComment);
                  setDeclineModal(null);
                  setDeclineComment('');
                }}
                disabled={!declineComment.trim()}
                className="px-4 py-2 text-sm bg-red-500 text-white rounded-full hover:bg-red-600 disabled:opacity-50"
              >
                Confirm Decline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}