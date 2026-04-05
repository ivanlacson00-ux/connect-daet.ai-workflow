'use client';

import { useAdminStats } from '@/hooks/useAdminStats';
<<<<<<< HEAD
import Link from 'next/link';
=======
>>>>>>> origin

export default function AdminDashboard() {
  const { stats } = useAdminStats();

  const statCards = [
    { label: 'Total Users',          value: stats.totalUsers,         color: 'bg-blue-500' },
    { label: 'Pending Approver',      value: stats.pendingApprover,    color: 'bg-yellow-400' },
    { label: 'Pending Admin',         value: stats.pendingAdmin,       color: 'bg-orange-500' },
<<<<<<< HEAD
    { label: 'Approved',              value: stats.approved,           color: 'bg-green-500' },
=======
    { label: 'Approved',               value: stats.approved,           color: 'bg-green-500' },
>>>>>>> origin
    { label: 'Declined by Approver',  value: stats.declinedByApprover, color: 'bg-red-400' },
    { label: 'Declined by Admin',     value: stats.declinedByAdmin,    color: 'bg-red-600' },
  ];

<<<<<<< HEAD
  const quickLinks = [
    { href: '/workflow/admin/pending',         label: '⏳ My Pending Reviews',  desc: 'Submissions waiting for your final decision' },
    { href: '/workflow/admin/submissions',     label: '📁 All Submissions',    desc: 'View and filter all submissions' },
    { href: '/workflow/admin/user_management', label: '👥 User Management',    desc: 'Manage user roles and accounts' },
  ];

=======
>>>>>>> origin
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Admin Overview</h1>
        <p className="text-sm text-gray-500 mt-1">Real-time status of the CONNECT-Daet.ai workflow system.</p>
      </div>

      {/* Stat Cards */}
<<<<<<< HEAD
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {statCards.map((card) => (
          <div key={card.label} className={`${card.color} rounded-2xl p-4 text-white shadow`}>
            <p className="text-xs opacity-80">{card.label}</p>
            <p className="text-4xl font-bold mt-1">{card.value}</p>
=======
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className={`${card.color} rounded-2xl p-5 text-white shadow-sm transition-transform hover:scale-[1.02]`}>
            <p className="text-xs font-medium opacity-80 uppercase tracking-wider">{card.label}</p>
            <p className="text-4xl font-bold mt-2">{card.value}</p>
>>>>>>> origin
          </div>
        ))}
      </div>

      {/* Transaction Summary */}
<<<<<<< HEAD
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

=======
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
>>>>>>> origin
    </div>
  );
}
