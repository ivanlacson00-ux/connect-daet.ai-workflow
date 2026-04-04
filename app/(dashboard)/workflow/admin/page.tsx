// src/app/workflow/admin/page.tsx
'use client';

import { useState } from 'react';
import { useAdminStats } from '@/hooks/useAdminStats';
import { useSubmissions } from '@/hooks/useSubmissions';
import { useUsers } from '@/hooks/useUsers';

type Tab = 'overview' | 'pending_admin' | 'all_submissions' | 'users' | 'audit';

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [declineModal, setDeclineModal] = useState<{ id: string } | null>(null);
  const [declineComment, setDeclineComment] = useState('');

  const { stats } = useAdminStats();
  const { submissions, loading, adminApprove, adminDecline } = useSubmissions(
    activeTab === 'pending_admin' ? 'pending_admin' : undefined
  );
  const { users, updateRole } = useUsers();

  const statCards = [
    { label: 'Total Users',         value: stats.totalUsers,         color: 'bg-blue-500' },
    { label: 'Pending Approver',     value: stats.pendingApprover,    color: 'bg-yellow-400' },
    { label: 'Pending Admin',        value: stats.pendingAdmin,       color: 'bg-orange-500' },
    { label: 'Approved',             value: stats.approved,           color: 'bg-green-500' },
    { label: 'Declined by Approver', value: stats.declinedByApprover, color: 'bg-red-400' },
    { label: 'Declined by Admin',    value: stats.declinedByAdmin,    color: 'bg-red-600' },
  ];

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview',         label: '📊 Overview' },
    { key: 'pending_admin',    label: '⏳ Pending My Review' },
    { key: 'all_submissions',  label: '📁 All Submissions' },
    { key: 'users',            label: '👥 User Management' },
  ];

  const statusColor: Record<string, string> = {
    pending_approver:    'bg-yellow-100 text-yellow-700',
    pending_admin:       'bg-orange-100 text-orange-700',
    approved:            'bg-green-100 text-green-700',
    declined_by_approver:'bg-red-100 text-red-500',
    declined_by_admin:   'bg-red-200 text-red-700',
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Admin Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">CONNECT-Daet.ai — Workflow Subsystem</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 border hover:bg-gray-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === 'overview' && (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            {statCards.map((card) => (
              <div key={card.label} className={`${card.color} rounded-2xl p-4 text-white shadow`}>
                <p className="text-xs opacity-80">{card.label}</p>
                <p className="text-4xl font-bold mt-1">{card.value}</p>
              </div>
            ))}
          </div>

          {/* Transaction Summary Table */}
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Transaction Summary</h2>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-gray-400">
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Count</th>
                  <th className="pb-2">Description</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { status: 'Pending Approver',     count: stats.pendingApprover,    desc: 'Waiting for approver review',      color: 'text-yellow-500' },
                  { status: 'Pending Admin',         count: stats.pendingAdmin,       desc: 'Approver approved, awaiting admin', color: 'text-orange-500' },
                  { status: 'Approved',              count: stats.approved,           desc: 'Fully approved by admin',           color: 'text-green-600' },
                  { status: 'Declined by Approver',  count: stats.declinedByApprover, desc: 'Rejected at stage 1',               color: 'text-red-400' },
                  { status: 'Declined by Admin',     count: stats.declinedByAdmin,    desc: 'Rejected at final stage',           color: 'text-red-600' },
                ].map((row) => (
                  <tr key={row.status} className="border-b last:border-0">
                    <td className={`py-3 font-semibold ${row.color}`}>{row.status}</td>
                    <td className="py-3 font-bold">{row.count}</td>
                    <td className="py-3 text-gray-400">{row.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── PENDING ADMIN / ALL SUBMISSIONS TAB ── */}
      {(activeTab === 'pending_admin' || activeTab === 'all_submissions') && (
        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">
            {activeTab === 'pending_admin' ? '⏳ Pending My Review' : '📁 All Submissions'}
          </h2>

          {loading ? (
            <p className="text-gray-400">Loading submissions...</p>
          ) : submissions.length === 0 ? (
            <p className="text-gray-400">No submissions found.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-gray-400">
                  <th className="pb-2">File</th>
                  <th className="pb-2">Uploaded By</th>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Status</th>
                  {activeTab === 'pending_admin' && <th className="pb-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub) => (
                  <tr key={sub.id} className="border-b last:border-0">
                    <td className="py-3">
                      <a href={sub.file_url} target="_blank" className="text-blue-600 underline">
                        {sub.file_name}
                      </a>
                    </td>
                    <td className="py-3 text-gray-500">{sub.profiles?.email ?? '—'}</td>
                    <td className="py-3 text-gray-400">
                      {new Date(sub.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[sub.status]}`}>
                        {sub.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    {activeTab === 'pending_admin' && (
                      <td className="py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => adminApprove(sub.id)}
                            className="px-3 py-1 bg-green-500 text-white text-xs rounded-full hover:bg-green-600"
                          >
                            ✅ Approve
                          </button>
                          <button
                            onClick={() => setDeclineModal({ id: sub.id })}
                            className="px-3 py-1 bg-red-500 text-white text-xs rounded-full hover:bg-red-600"
                          >
                            ❌ Decline
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── USER MANAGEMENT TAB ── */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">👥 User Management</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-gray-400">
                <th className="pb-2">Email</th>
                <th className="pb-2">Role</th>
                <th className="pb-2">Joined</th>
                <th className="pb-2">Change Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b last:border-0">
                  <td className="py-3">{user.email}</td>
                  <td className="py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      user.role === 'admin'    ? 'bg-blue-100 text-blue-700' :
                      user.role === 'approver' ? 'bg-purple-100 text-purple-700' :
                                                 'bg-gray-100 text-gray-600'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="py-3 text-gray-400">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-3">
                    <select
                      value={user.role}
                      onChange={(e) => updateRole(user.id, e.target.value as 'user' | 'approver' | 'admin')}
                      className="border rounded-lg px-2 py-1 text-xs"
                    >
                      <option value="user">User</option>
                      <option value="approver">Approver</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── DECLINE MODAL ── */}
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
                className="px-4 py-2 text-sm bg-red-500 text-white rounded-full hover:bg-red-600"
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