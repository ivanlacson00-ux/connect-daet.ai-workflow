"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

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

export default function ApproverDashboard() {
  const supabase = createClient();

  const [requests, setRequests] = useState<Request[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotif, setShowNotif] = useState(false);

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
          name: item.name || item.full_name || item.submitter_name || "Unknown", // Try different column names
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

  // ✅ APPROVE / REJECT FUNCTION WITH ENHANCED NOTIFICATIONS
  const handleAction = async (
    id: number,
    action: "approved" | "rejected"
  ) => {
    const newStatus =
      action === "approved" ? "pending_admin" : "rejected";

    // 1. Get submission info with all details
    const { data: submission, error: fetchError } = await supabase
      .from("workflow_submissions")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError) {
      console.error("Error fetching submission:", fetchError.message);
      return;
    }

    // Get the name and email from available fields
    const submissionName = submission.name || submission.full_name || submission.submitter_name || `Submission #${id}`;
    const submissionEmail = submission.email || submission.submitter_email || "No email provided";
    const submissionFile = submission.file_url || submission.file || submission.document_url;

    // 2. Update submission
    const { error: updateError } = await supabase
      .from("workflow_submissions")
      .update({ status: newStatus })
      .eq("id", id);

    if (updateError) {
      console.error("Error updating submission:", updateError.message);
      return;
    }

    // 3. Create appropriate notifications based on action
    if (action === "approved") {
      // Notify USER that their submission is approved and sent to admin
      const userMessage = `Your submission "${submissionName}" has been approved by approver and sent to admin for final approval.`;
      
      if (submission.user_id) {
        await supabase.from("notifications").insert([
          {
            user_id: submission.user_id,
            message: userMessage,
            submission_id: id,
            type: "status_update",
            created_at: new Date().toISOString(),
          },
        ]);
      }

      // Notify ADMIN about pending approval with file details
      const adminMessage = `📄 New submission requires your approval!\n\nName: ${submissionName}\nEmail: ${submissionEmail}\nFile: ${submissionFile || "No file attached"}\n\nPlease review and take action.`;
      
      await supabase.from("notifications").insert([
        {
          user_id: null, // This represents admin - you can replace with specific admin_id
          message: adminMessage,
          submission_id: id,
          type: "admin_approval_needed",
          created_at: new Date().toISOString(),
        },
      ]);
    } 
    else if (action === "rejected") {
      // Notify USER that their submission was rejected with reason
      const rejectionMessage = `❌ Your submission "${submissionName}" has been rejected by the approver.\n\nPlease review your submission and resubmit if necessary.\n\nSubmission details:\n• Email: ${submissionEmail}\n• File: ${submissionFile || "No file attached"}`;
      
      if (submission.user_id) {
        await supabase.from("notifications").insert([
          {
            user_id: submission.user_id,
            message: rejectionMessage,
            submission_id: id,
            type: "rejected",
            created_at: new Date().toISOString(),
          },
        ]);
      }

      // Optional: Notify admin about the rejection for tracking
      const adminRejectionMessage = `⚠️ Submission #${id} (${submissionName}) was rejected by approver.`;
      
      await supabase.from("notifications").insert([
        {
          user_id: null,
          message: adminRejectionMessage,
          submission_id: id,
          type: "rejection_tracking",
          created_at: new Date().toISOString(),
        },
      ]);
    }

    // 4. Update UI
    setRequests((prev) =>
      prev.map((req) =>
        req.id === id ? { ...req, status: newStatus } : req
      )
    );

    // 5. Refresh notifications to show the new ones
    const { data: updatedNotifications } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);

    if (updatedNotifications) {
      setNotifications(updatedNotifications);
    }
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
                    onClick={() =>
                      handleAction(req.id, "approved")
                    }
                    disabled={req.status !== "pending_approver"}
                    className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
                  >
                    Approve
                  </button>

                  <button
                    onClick={() =>
                      handleAction(req.id, "rejected")
                    }
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
    </div>
  );
}