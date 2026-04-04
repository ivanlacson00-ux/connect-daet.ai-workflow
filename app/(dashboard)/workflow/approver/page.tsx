"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Request = {
  id: number;
  name: string;
  email: string;
  status: "pending" | "pending_admin" | "approved" | "rejected";
  file_url?: string;
};

export default function ApproverDashboard() {
  const [requests, setRequests] = useState<Request[]>([]);
  const supabase = createClient();

  // ✅ FETCH DATA FROM YOUR EXISTING SUPABASE
  useEffect(() => {
    const fetchRequests = async () => {
      const { data, error } = await supabase
        .from("workflow_submissions")
        .select("*")
        .order("id", { ascending: false });

      if (error) {
        console.error(error.message);
        return;
      }

      const formatted: Request[] = data.map((item: any) => ({
        id: item.id,
        name: item.name,
        email: item.email,
        status: item.status || "pending",
        file_url: item.file_url,
      }));

      setRequests(formatted);
    };

    fetchRequests();
  }, []);

  // ✅ APPROVE / REJECT + NOTIFICATION
  const handleAction = async (
    id: number,
    action: "approved" | "rejected"
  ) => {
    const newStatus =
      action === "approved" ? "pending_admin" : "rejected";

    // 1. Get user_id
    const { data: submission, error: fetchError } = await supabase
      .from("workflow_submissions")
      .select("user_id")
      .eq("id", id)
      .single();

    if (fetchError) {
      console.error(fetchError.message);
      return;
    }

    // 2. Update status
    const { error: updateError } = await supabase
      .from("workflow_submissions")
      .update({ status: newStatus })
      .eq("id", id);

    if (updateError) {
      console.error(updateError.message);
      return;
    }

    // 3. Insert notification
    const message =
      action === "approved"
        ? "Your submission is approved and pending for admin approval."
        : "Your submission has been rejected.";

    const { error: notifError } = await supabase
      .from("notifications")
      .insert([
        {
          user_id: submission.user_id,
          message: message,
        },
      ]);

    if (notifError) {
      console.error(notifError.message);
    }

    // 4. Update UI
    setRequests((prev) =>
      prev.map((req) =>
        req.id === id ? { ...req, status: newStatus } : req
      )
    );
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      {/* HEADER */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">
          Approver Dashboard
        </h1>
        <p className="text-gray-500">Manage submissions</p>
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
                    onClick={() => handleAction(req.id, "approved")}
                    disabled={req.status !== "pending"}
                    className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
                  >
                    Approve
                  </button>

                  <button
                    onClick={() => handleAction(req.id, "rejected")}
                    disabled={req.status !== "pending"}
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
