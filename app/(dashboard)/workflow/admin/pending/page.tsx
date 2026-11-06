'use client';

import { useSubmissions } from '@/hooks/useSubmissions';
import Link from 'next/link';

export default function PendingPage() {
  const { submissions, loading } = useSubmissions('pending_admin');

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
          Verify the approver-selected office route or archive the request with a reason.
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
                <th className="pb-3">Action</th>
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
                    <Link
                      href={`/workflow/admin/submissions/${sub.id}`}
                      className="inline-flex rounded-full bg-orange-500 px-3 py-1 text-xs text-white hover:bg-orange-600"
                    >
                      Verify route
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}