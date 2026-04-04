// app/(dashboard)/workflow/approver/notifications/approve.tsx
"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

type ApproveModalProps = {
  isOpen: boolean;
  submission: {
    id: number;
    name: string;
    email: string;
    file_url?: string;
  };
  onClose: () => void;
  onConfirm: (id: number, approverDetails: ApproverDetails) => void;
};

type ApproverDetails = {
  name: string;
  email: string;
  approvedAt: string;
  notes?: string;
};

export default function ApproveModal({ isOpen, submission, onClose, onConfirm }: ApproveModalProps) {
  const supabase = createClient();
  const [approverName, setApproverName] = useState("");
  const [approverEmail, setApproverEmail] = useState("");
  const [approvalNotes, setApprovalNotes] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      fetchCurrentApprover();
    }
  }, [isOpen]);

  const fetchCurrentApprover = async () => {
    setLoading(true);
    // Get current user session
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      setApproverName(user.user_metadata?.full_name || user.email?.split('@')[0] || "Approver");
      setApproverEmail(user.email || "No email");
    } else {
      setApproverName("Unknown Approver");
      setApproverEmail("Unknown");
    }
    setLoading(false);
  };

  const handleConfirm = () => {
    const approverDetails: ApproverDetails = {
      name: approverName,
      email: approverEmail,
      approvedAt: new Date().toISOString(),
      notes: approvalNotes || undefined
    };
    onConfirm(submission.id, approverDetails);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-800">Approve Submission</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        {/* Submission Details */}
        <div className="mb-6 p-3 bg-gray-50 rounded-md">
          <h3 className="font-semibold text-gray-700 mb-2">Submission Details</h3>
          <p className="text-sm text-gray-600"><strong>ID:</strong> {submission.id}</p>
          <p className="text-sm text-gray-600"><strong>Name:</strong> {submission.name}</p>
          <p className="text-sm text-gray-600"><strong>Email:</strong> {submission.email}</p>
          {submission.file_url && (
            <p className="text-sm text-gray-600">
              <strong>File:</strong> 
              <a href={submission.file_url} target="_blank" className="text-blue-500 underline ml-1">View File</a>
            </p>
          )}
        </div>

        {/* Approver Information */}
        <div className="mb-6">
          <h3 className="font-semibold text-gray-700 mb-3">Approver Information</h3>
          
          {loading ? (
            <div className="text-gray-500">Loading approver details...</div>
          ) : (
            <>
              <div className="mb-3 p-3 bg-green-50 rounded-md border border-green-200">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-green-600">✅</span>
                  <span className="font-medium text-green-700">You are approving this submission</span>
                </div>
                <p className="text-sm text-gray-700"><strong>Approver Name:</strong> {approverName}</p>
                <p className="text-sm text-gray-700"><strong>Approver Email:</strong> {approverEmail}</p>
                <p className="text-sm text-gray-700">
                  <strong>Approval Time:</strong> {new Date().toLocaleString()}
                </p>
                <p className="text-sm text-gray-700">
                  <strong>Approval Date:</strong> {new Date().toLocaleDateString()}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Optional Notes */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Approval Notes (Optional)
          </label>
          <textarea
            value={approvalNotes}
            onChange={(e) => setApprovalNotes(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="Add any notes about this approval (optional)..."
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleConfirm}
            className="flex-1 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
          >
            Confirm Approval
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}