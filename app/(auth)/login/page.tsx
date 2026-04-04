"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Request = {
  id: number;
  name: string;
  email: string;
  status: "pending" | "approved" | "rejected";
  file_url?: string;
};

export default function ApproverDashboard() {
  const [requests, setRequests] = useState<Request[]>([]);
  const supabase = createClient();

  // ✅ FETCH DATA FROM SUPABASE
  useEffect(() => {
    const fetchRequests = async () => {
      const { data, error } = await supabase
        .from("workflow_submissions")
        .select("*")
        .order("id", { ascending: false });

      if (error) {
        console.error("Fetch error:", error.message);
        return;
      }

      const formatted: Request[] = data.map((item: any) => ({
        id: item.id,
        name: item.name || "No Name",
        email: item.email || "No Email",
        status: item.status || "pending",
        file_url: item.file_url || null,
      }));

      setRequests(formatted);
    };

    fetchRequests();
  }, []);

  // ✅ APPROVE / REJECT FUNCTION
  const handleAction = async (
    id: number,
    action: "approved" | "rejected"
  ) => {
    const { error } = await supabase
      .from("workflow_submissions")
      .update({ status: action })
      .eq("id", id);

    if (error) {
      console.error("Update error:", error.message);
      return;
    }

    // Update UI instantly
    setRequests((prev) =>
      prev.map((req) =>
        req.id === id ? { ...req, status: action } : req
      )
    );
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">
          Approver Dashboard
        </h1>
        <p className="text-gray-500">Manage user submissions</p>
      </div>

      {/* Table */}
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

                {/* FILE LINK */}
                <td className="p-3">
                  {req.file_url ? (
                    <a
                      href={req.file_url}
                      target="_blank"
                      className="text-blue-500 underline"
                    >
                      View File
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
                        : req.status === "approved"
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {req.status}
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

        {/* EMPTY STATE */}
        {requests.length === 0 && (
          <div className="p-6 text-center text-gray-500">
            No submissions found
          </div>
        )}
      </div>
    </div>
  );
}
