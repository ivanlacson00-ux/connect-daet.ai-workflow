// src/app/workflow/admin/page.tsx
'use client';

import { useAdminStats } from '@/hooks/useAdminStats';
import Link from 'next/link';

export default function AdminDashboard() {
  const { stats } = useAdminStats();

  const statCards = [
    { label: 'Total Users',          value: stats.totalUsers,         color: 'bg-blue-500' },
    { label: 'Pending Approver',      value: stats.pendingApprover,    color: 'bg-yellow-400' },
    { label: 'Pending Admin',         value: stats.pendingAdmin,       color: 'bg-orange-500' },
    { label: 'Approved',              value: stats.approved,           color: 'bg-green-500' },
    { label: 'Declined by Approver',  value: stats.declinedByApprover, color: 'bg-red-400' },
    { label: 'Declined by Admin',     value: stats.declinedByAdmin,    color: 'bg-red-600' },
  ];

  const quickLinks = [
    { href: '/workflow/admin/pending',         label: '⏳ My Pending Reviews',  desc: 'Submissions waiting for your final decision' },
    { href: '/workflow/admin/submissions',     label: '📁 All Submissions',    desc: 'View and filter all submissions' },
    { href: '/workflow/admin/user_management', label: '👥 User Management',    desc: 'Manage user roles and accounts' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Admin Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">CONNECT-Daet.ai — Workflow Subsystem</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {statCards.map((card) => (
          <div key={card.label} className={`${card.color} rounded-2xl p-4 text-white shadow`}>
            <p className="text-xs opacity-80">{card.label}</p>
            <p className="text-4xl font-bold mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Transaction Summary */}
      <div className="bg-white rounded-2xl shadow p-6 mb-8">
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
              { status: 'Pending Approver',    count: stats.pendingApprover,    desc: 'Waiting for approver review',       color: 'text-yellow-500' },
              { status: 'Pending Admin',        count: stats.pendingAdmin,       desc: 'Approver approved, awaiting admin', color: 'text-orange-500' },
              { status: 'Approved',             count: stats.approved,           desc: 'Fully approved by admin',           color: 'text-green-600' },
              { status: 'Declined by Approver', count: stats.declinedByApprover, desc: 'Rejected at stage 1',               color: 'text-red-400' },
              { status: 'Declined by Admin',    count: stats.declinedByAdmin,    desc: 'Rejected at final stage',           color: 'text-red-600' },
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

      {/* Quick Links to sub-pages */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {quickLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="bg-white rounded-2xl shadow p-5 hover:shadow-md transition hover:bg-blue-50 border border-transparent hover:border-blue-200"
          >
            <p className="text-lg font-semibold text-gray-800">{link.label}</p>
            <p className="text-sm text-gray-400 mt-1">{link.desc}</p>
          </Link>
        ))}
      </div>

    </div>
  );
}
