"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ApproveModal from "./notifications/approve";
import RejectModal from "./notifications/reject";

type Request = {
  id: number;
  name: string;
  email: string;
  status:
    | "pending"
    | "pending_approver"
    | "pending_admin"
    | "approved"
    | "rejected";
  file_url?: string;
};

type ApproverDetails = {
  name: string;
  email: string;
  approvedAt: string;
  notes?: string;
};

type RejectionDetails = {
  reason: string;
  notes: string;
  rejectedBy: string;
  rejectedByEmail: string;
  rejectedAt: string;
};

export default function ApproverDashboard() {
  const supabase = createClient();

  const [requests, setRequests] = useState<Request[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotif, setShowNotif] = useState(false);
  
  // Modal states
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState<Request | null>(null);

  // ✅ FETCH SUBMISSIONS
  useEffect(() => {
    const fetchRequests = async () => {
      const { data, error } = await supabase
        .from("workflow_submissions")
        .select("*")
        .order("id", { ascending: false });

      if (!error && data) {
        const formatted: Request[] = data.map((item: any) => ({
          id: item.id,
          name: item.name || item.full_name || item.submitter_name || "Unknown",
          email: item.email || item.submitter_email || "Unknown",
          status: item.status || "pending",
          file_url: item.file_url || item.file || item.document_url,
        }));

        setRequests(formatted);
      } else if (error) {
        console.error("Error fetching requests:", error);
      }
    };

    fetchRequests();
  }, []);

  // ✅ FETCH NOTIFICATIONS
  useEffect(() => {
    const fetchNotifications = async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);

      if (!error && data) {
        setNotifications(data);
      }
    };

    fetchNotifications();
  }, []);

  // ✅ FUNCTION TO NOTIFY ADMIN WHEN APPROVED
  const notifyAdminOnApproval = async (
    submissionId: number,
    submissionName: string,
    submissionEmail: string,
    submissionFile: string,
    approverDetails: ApproverDetails
  ) => {
    try {
      const adminNotification = {
        user_id: null,
        submission_id: submissionId,
        type: "admin_approval_needed",
        message: `🔔 NEW SUBMISSION AWAITING ADMIN APPROVAL\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📋 Submission Details:\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n• Submission ID: #${submissionId}\n• Name: ${submissionName}\n• Email: ${submissionEmail}\n• File: ${submissionFile || "No file attached"}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n✅ This submission has been reviewed and approved by:\n• Approver: ${approverDetails.name}\n• Email: ${approverDetails.email}\n• Approved at: ${new Date(approverDetails.approvedAt).toLocaleString()}\n${approverDetails.notes ? `• Notes: ${approverDetails.notes}\n` : ''}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n⏳ Now awaiting your final approval.\n\nPlease review and take action.`,
        created_at: new Date().toISOString(),
        read: false,
      };

      await supabase.from("notifications").insert([adminNotification]);
    } catch (error) {
      console.error("Failed to notify admin:", error);
    }
  };

  // ✅ HANDLE APPROVAL WITH DETAILS (UPDATED - only update status)
  const handleApproval = async (id: number, approverDetails: ApproverDetails) => {
    // 1. Get submission info
    const { data: submission, error: fetchError } = await supabase
      .from("workflow_submissions")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError) {
      console.error("Error fetching submission:", fetchError.message);
      return;
    }

    const submissionName = submission.name || submission.full_name || submission.submitter_name || `Submission #${id}`;
    const submissionEmail = submission.email || submission.submitter_email || "No email provided";
    const submissionFile = submission.file_url || submission.file || submission.document_url;

    // 2. Update submission - ONLY update status (removed column references)
    const { error: updateError } = await supabase
      .from("workflow_submissions")
      .update({ 
        status: "pending_admin"
      })
      .eq("id", id);

    if (updateError) {
      console.error("Error updating submission:", updateError.message);
      return;
    }

    // 3. Store approver details in a separate metadata table or notification
    // For now, we'll just include it in the notification
    const approvalMetadata = {
      approved_by: approverDetails.name,
      approved_by_email: approverDetails.email,
      approved_at: approverDetails.approvedAt,
      approval_notes: approverDetails.notes
    };

    // 4. Notify user
    const userMessage = `✅ Your submission "${submissionName}" has been approved by ${approverDetails.name} and forwarded to the admin for final approval.\n\nApproved on: ${new Date(approverDetails.approvedAt).toLocaleString()}\n${approverDetails.notes ? `\nApprover's Notes: ${approverDetails.notes}` : ''}\n\nYou will be notified once the admin makes a decision.`;
    
    if (submission.user_id) {
      await supabase.from("notifications").insert([
        {
          user_id: submission.user_id,
          message: userMessage,
          submission_id: id,
          type: "status_update",
          created_at: new Date().toISOString(),
          read: false,
        },
      ]);
    }

    // 5. Notify admin with approval details
    await notifyAdminOnApproval(id, submissionName, submissionEmail, submissionFile, approverDetails);

    // 6. Update UI
    setRequests((prev) =>
      prev.map((req) =>
        req.id === id ? { ...req, status: "pending_admin" } : req
      )
    );

    // 7. Refresh notifications
    const { data: updatedNotifications } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);

    if (updatedNotifications) {
      setNotifications(updatedNotifications);
    }
  };

  // ✅ HANDLE REJECTION WITH DETAILS (UPDATED - removed all missing columns)
  const handleRejection = async (id: number, rejectionDetails: RejectionDetails) => {
    // 1. Get submission info
    const { data: submission, error: fetchError } = await supabase
      .from("workflow_submissions")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError) {
      console.error("Error fetching submission:", fetchError.message);
      return;
    }

    const submissionName = submission.name || submission.full_name || submission.submitter_name || `Submission #${id}`;
    const submissionEmail = submission.email || submission.submitter_email || "No email provided";
    const submissionFile = submission.file_url || submission.file || submission.document_url;

    // 2. Update submission - ONLY update status (removed all missing columns)
    const { error: updateError } = await supabase
      .from("workflow_submissions")
      .update({ 
        status: "rejected"
      })
      .eq("id", id);

    if (updateError) {
      console.error("Error updating submission:", updateError.message);
      return;
    }

    // 3. Notify user with rejection details (details are in the notification only)
    const rejectionMessage = `❌ SUBMISSION REJECTED\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📋 Your submission has been rejected by the approver.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nSubmission Details:\n• ID: #${id}\n• Name: ${submissionName}\n• Email: ${submissionEmail}\n• File: ${submissionFile || "No file attached"}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n📝 REJECTION REASON:\n${rejectionDetails.reason}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${rejectionDetails.notes ? `📌 APPROVER'S EXPLANATION:\n${rejectionDetails.notes}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` : ''}👤 Rejected By: ${rejectionDetails.rejectedBy}\n📅 Rejected On: ${new Date(rejectionDetails.rejectedAt).toLocaleString()}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n💡 Next Steps:\n• Please review the feedback above\n• Make necessary corrections to your submission\n• Resubmit your file with the required changes\n• Contact support if you need clarification\n\nWe appreciate your understanding and look forward to your improved submission.`;
    
    if (submission.user_id) {
      await supabase.from("notifications").insert([
        {
          user_id: submission.user_id,
          message: rejectionMessage,
          submission_id: id,
          type: "rejected",
          created_at: new Date().toISOString(),
          read: false,
        },
      ]);
    }

    // 4. Notify admin about rejection
    const adminRejectionMessage = `⚠️ SUBMISSION REJECTED BY APPROVER\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n• Submission #${id}\n• Name: ${submissionName}\n• Email: ${submissionEmail}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n📝 Rejection Reason: ${rejectionDetails.reason}\n${rejectionDetails.notes ? `📌 Notes: ${rejectionDetails.notes}\n` : ''}👤 Rejected By: ${rejectionDetails.rejectedBy}\n📅 Rejected On: ${new Date(rejectionDetails.rejectedAt).toLocaleString()}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nThis submission has been rejected at the approver level.`;
    
    await supabase.from("notifications").insert([
      {
        user_id: null,
        message: adminRejectionMessage,
        submission_id: id,
        type: "rejection_tracking",
        created_at: new Date().toISOString(),
        read: false,
      },
    ]);

    // 5. Update UI
    setRequests((prev) =>
      prev.map((req) =>
        req.id === id ? { ...req, status: "rejected" } : req
      )
    );

    // 6. Refresh notifications
    const { data: updatedNotifications } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);

    if (updatedNotifications) {
      setNotifications(updatedNotifications);
    }
  };

  // Open modals
  const openApproveModal = (submission: Request) => {
    setSelectedSubmission(submission);
    setShowApproveModal(true);
  };

  const openRejectModal = (submission: Request) => {
    setSelectedSubmission(submission);
    setShowRejectModal(true);
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      {/* HEADER + NOTIFICATION */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">
            Approver Dashboard
          </h1>
          <p className="text-gray-500">Manage submissions</p>
        </div>

        {/* 🔔 Notification Bell */}
        <div className="relative">
          <button
            onClick={() => setShowNotif(!showNotif)}
            className="relative text-xl"
          >
            🔔

            {notifications.length > 0 && (
              <span className="absolute -top-1 -right-2 bg-red-500 text-white text-xs px-1 rounded-full">
                {notifications.length}
              </span>
            )}
          </button>

          {/* Dropdown */}
          {showNotif && (
            <div className="absolute right-0 mt-2 w-80 bg-white shadow-lg rounded-lg p-3 z-50">
              <h3 className="font-semibold mb-2">Notifications</h3>

              {notifications.length === 0 ? (
                <p className="text-gray-500 text-sm">
                  No notifications
                </p>
              ) : (
                notifications.map((notif) => (
                  <div
                    key={notif.id}
                    className="text-sm border-b py-2 last:border-b-0"
                  >
                    <div className="whitespace-pre-wrap">{notif.message}</div>
                    {notif.created_at && (
                      <div className="text-xs text-gray-400 mt-1">
                        {new Date(notif.created_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* TABLE */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-200 text-gray-600 text-sm">
            <tr>
              <th className="p-3">ID</th>
              <th className="p-3">Name</th>
              <th className="p-3">Email</th>
              <th className="p-3">File</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-center">Actions</th>
            </tr>
          </thead>

          <tbody>
            {requests.map((req) => (
              <tr key={req.id} className="border-t">
                <td className="p-3">{req.id}</td>
                <td className="p-3">{req.name}</td>
                <td className="p-3">{req.email}</td>

                {/* FILE */}
                <td className="p-3">
                  {req.file_url ? (
                    <a
                      href={req.file_url}
                      target="_blank"
                      className="text-blue-500 underline"
                    >
                      View
                    </a>
                  ) : (
                    "No File"
                  )}
                </td>

                {/* STATUS */}
                <td className="p-3">
                  <span
                    className={`px-2 py-1 rounded text-sm ${
                      req.status === "pending"
                        ? "bg-yellow-100 text-yellow-700"
                        : req.status === "pending_approver"
                        ? "bg-orange-100 text-orange-700"
                        : req.status === "pending_admin"
                        ? "bg-blue-100 text-blue-700"
                        : req.status === "approved"
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {req.status === "pending_admin"
                      ? "pending admin"
                      : req.status}
                  </span>
                </td>

                {/* ACTIONS */}
                <td className="p-3 flex justify-center gap-2">
                  <button
                    onClick={() => openApproveModal(req)}
                    disabled={req.status !== "pending_approver"}
                    className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
                  >
                    Approve
                  </button>

                  <button
                    onClick={() => openRejectModal(req)}
                    disabled={req.status !== "pending_approver"}
                    className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {requests.length === 0 && (
          <div className="p-6 text-center text-gray-500">
            No submissions found
          </div>
        )}
      </div>

      {/* Modals */}
      {selectedSubmission && (
        <>
          <ApproveModal
            isOpen={showApproveModal}
            submission={selectedSubmission}
            onClose={() => {
              setShowApproveModal(false);
              setSelectedSubmission(null);
            }}
            onConfirm={handleApproval}
          />
          
          <RejectModal
            isOpen={showRejectModal}
            submission={selectedSubmission}
            onClose={() => {
              setShowRejectModal(false);
              setSelectedSubmission(null);
            }}
            onConfirm={handleRejection}
          />
        </>
      )}
    </div>
  );
}