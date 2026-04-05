// src/app/workflow/admin/page.tsx
'use client';

import { useAdminStats } from '@/hooks/useAdminStats';

export default function AdminDashboard() {
  const { stats } = useAdminStats();

  const statCards = [
    { label: 'Total Users',          value: stats.totalUsers,         color: 'bg-blue-500' },
    { label: 'Pending Approver',      value: stats.pendingApprover,    color: 'bg-yellow-400' },
    { label: 'Pending Admin',         value: stats.pendingAdmin,       color: 'bg-orange-500' },
    { label: 'Approved',               value: stats.approved,           color: 'bg-green-500' },
    { label: 'Declined by Approver',  value: stats.declinedByApprover, color: 'bg-red-400' },
    { label: 'Declined by Admin',     value: stats.declinedByAdmin,    color: 'bg-red-600' },
  ];

<<<<<<< HEAD
=======
  const quickLinks = [
    { href: '/workflow/admin/pending',         label: '⏳ My Pending Reviews',  desc: 'Submissions waiting for your final decision' },
    { href: '/workflow/admin/submissions',     label: '📁 All Submissions',    desc: 'View and filter all submissions' },
    { href: '/workflow/admin/user_management', label: '👥 User Management',    desc: 'Manage user roles and accounts' },
  ];

>>>>>>> ac264e83fd40cefe5574619ce477446787f20e3f
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Admin Overview</h1>
        <p className="text-sm text-gray-500 mt-1">Real-time status of the CONNECT-Daet.ai workflow system.</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className={`${card.color} rounded-2xl p-5 text-white shadow-sm transition-transform hover:scale-[1.02]`}>
            <p className="text-xs font-medium opacity-80 uppercase tracking-wider">{card.label}</p>
            <p className="text-4xl font-bold mt-2">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Transaction Summary */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800">Status Breakdown</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-400 uppercase text-[11px] font-bold tracking-widest">
                <th className="px-6 py-4">Current Status</th>
                <th className="px-6 py-4 text-center">Count</th>
                <th className="px-6 py-4">System Context</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[
                { status: 'Pending Approver',    count: stats.pendingApprover,    desc: 'Initial review stage',           color: 'text-yellow-600 bg-yellow-50' },
                { status: 'Pending Admin',       count: stats.pendingAdmin,       desc: 'Final authorization required',   color: 'text-orange-600 bg-orange-50' },
                { status: 'Approved',            count: stats.approved,           desc: 'Successful workflow completion', color: 'text-green-600 bg-green-50' },
                { status: 'Declined by Approver', count: stats.declinedByApprover, desc: 'Returned at Level 1 review',     color: 'text-red-500 bg-red-50' },
                { status: 'Declined by Admin',    count: stats.declinedByAdmin,    desc: 'Rejected at Level 2 review',     color: 'text-red-700 bg-red-50' },
              ].map((row) => (
                <tr key={row.status} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${row.color}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-mono font-bold text-lg text-center">{row.count}</td>
                  <td className="px-6 py-4 text-gray-400 italic">{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}