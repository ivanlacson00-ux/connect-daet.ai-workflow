'use client';

import { Fragment } from 'react';
import { useSubmissions } from '@/hooks/useSubmissions';
import Link from 'next/link';
import WorkflowRoutingPipeline from '@/components/WorkflowRoutingPipeline';
import { useRoutePreviews } from '@/lib/workflow/useRoutePreviews';

export default function PendingPage() {
  const { submissions, loading } = useSubmissions('pending_admin');
  const routesBySubmission = useRoutePreviews(submissions);

  const statusColor: Record<string, string> = {
    pending:              'bg-pending-bg text-pending-text',
    pending_approver:     'bg-pending-bg text-pending-text',
    pending_admin:        'bg-pending-bg text-pending-text',
    approved:             'bg-approved-bg text-approved-text',
    declined_by_approver: 'bg-rejected-bg text-rejected-text',
    declined_by_admin:    'bg-rejected-bg text-rejected-text',
  };

  return (
    <div className="min-h-screen bg-cream p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-warm-text">My Pending Reviews</h1>
        <p className="mt-1 text-sm text-muted-text">
          Verify the approver-selected office route or archive the request with a reason.
        </p>
      </div>

      <div className="rounded-2xl bg-card p-6 shadow">
        {loading ? (
          <p className="text-muted-text">Loading submissions...</p>
        ) : submissions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-text">No pending submissions for your review.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-warm-border text-xs uppercase text-muted-text">
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
                <Fragment key={sub.id}>
                  <tr className="border-b border-warm-border last:border-0 hover:bg-sidebar">
                    <td className="py-3">
                      <span
                        onClick={() => window.open(`/api/workflow/files/${sub.id}?redirect=1`, '_blank')}
                        className="text-blue-600 underline font-medium cursor-pointer"
                      >
                        {sub.file_name}
                      </span>
                    </td>
                    <td className="py-3 text-muted-text">{sub.profiles?.email ?? '—'}</td>
                    <td className="py-3 text-xs uppercase text-muted-text">{sub.file_type}</td>
                    <td className="py-3 text-muted-text">
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
                        className="inline-flex rounded-full bg-clay px-3 py-1 text-xs text-white hover:bg-blue-700"
                      >
                        Verify route
                      </Link>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={6} className="border-b px-3 py-3">
                      <WorkflowRoutingPipeline
                        variant="compact"
                        submissionStatus={sub.status}
                        submittedAt={sub.created_at}
                        routeSteps={routesBySubmission[sub.id]?.steps ?? []}
                        routeStatus={routesBySubmission[sub.id]?.status ?? null}
                        routeFinalizedAt={routesBySubmission[sub.id]?.finalizedAt}
                        selectedOfficeRole={sub.selected_office_role}
                        initialDestinationRole={routesBySubmission[sub.id]?.initialDestinationRole}
                        finalDecisionOfficeRole={routesBySubmission[sub.id]?.finalDecisionOfficeRole}
                        auditEvents={routesBySubmission[sub.id]?.auditEvents ?? []}
                        routeLoadFailed={routesBySubmission[sub.id]?.loadFailed ?? false}
                      />
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}