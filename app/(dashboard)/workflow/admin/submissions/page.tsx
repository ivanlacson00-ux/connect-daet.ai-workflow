'use client';

import { useState } from 'react';
import { useSubmissions } from '@/hooks/useSubmissions';

type FilterStatus = 'all' | 'pending_approver' | 'pending_admin' | 'approved' | 'declined_by_approver' | 'declined_by_admin';

export default function SubmissionsPage() {
  const [filter, setFilter] = useState<FilterStatus>('all');
  const { submissions, loading } = useSubmissions(filter !== 'all' ? filter : undefined);

  const statusColor: Record<string, string> = {
    pending_approver:     'bg-yellow-100 text-yellow-700',
    pending_admin:        'bg-orange-100 text-orange-700',
    approved:             'bg-green-100 text-green-700',
    declined_by_approver: 'bg-red-100 text-red-500',
    declined_by_admin:    'bg-red-200 text-red-700',
  };

  const filters: { value: FilterStatus; label: string }[] = [
    { value: 'all',                  label: 'All' },
    { value: 'pending_approver',     label: 'Pending Approver' },
    { value: 'pending_admin',        label: 'Pending Admin' },
    { value: 'approved',             label: 'Approved' },
    { value: 'declined_by_approver', label: 'Declined by Approver' },
    { value: 'declined_by_admin',    label: 'Declined by Admin' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">All Submissions</h1>
        <p className="text-sm text-gray-500 mt-1">View and filter all submissions across the system</p>
      </div>

      <div className="flex gap-2 flex-wrap mb-6">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition ${
              filter === f.value
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 border hover:bg-gray-100'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow p-6">
        {loading ? (
          <p className="text-gray-400">Loading submissions...</p>
        ) : submissions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400">No submissions found.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-400 mb-4">{submissions.length} result(s) found</p>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-gray-400 text-xs uppercase">
                  <th className="pb-3">File</th>
                  <th className="pb-3">Uploaded By</th>
                  <th className="pb-3">Type</th>
                  <th className="pb-3">Date</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Rejection Reason</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub) => (
                  <tr key={sub.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-3 text-blue-600 underline font-medium">
                      {sub.file_name}
                    </td>
                    <td className="py-3 text-gray-500">{sub.profiles?.email ?? '—'}</td>
                    <td className="py-3 text-gray-400 uppercase text-xs">{sub.file_type}</td>
                    <td className="py-3 text-gray-400">
                      {new Date(sub.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[sub.status]}`}>
                        {sub.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-3 text-gray-400 text-xs">
                      {sub.rejection_comment ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}