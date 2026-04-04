// app/(dashboard)/workflow/approver/notifications/reject.tsx
"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

type RejectModalProps = {
  isOpen: boolean;
  submission: {
    id: number;
    name: string;
    email: string;
    file_url?: string;
  };
  onClose: () => void;
  onConfirm: (id: number, rejectionDetails: RejectionDetails) => void;
};

type RejectionDetails = {
  reason: string;
  notes: string;
  rejectedBy: string;
  rejectedByEmail: string;
  rejectedAt: string;
};

export default function RejectModal({ isOpen, submission, onClose, onConfirm }: RejectModalProps) {
  const supabase = createClient();
  const [rejectionReason, setRejectionReason] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [rejecterName, setRejecterName] = useState("");
  const [rejecterEmail, setRejecterEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [customReason, setCustomReason] = useState("");
  const [showCustomReason, setShowCustomReason] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchCurrentRejecter();
    }
  }, [isOpen]);

  const fetchCurrentRejecter = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      setRejecterName(user.user_metadata?.full_name || user.email?.split('@')[0] || "Approver");
      setRejecterEmail(user.email || "No email");
    } else {
      setRejecterName("Unknown Approver");
      setRejecterEmail("Unknown");
    }
    setLoading(false);
  };

  const handleConfirm = () => {
    const finalReason = showCustomReason ? customReason : rejectionReason;
    
    if (!finalReason.trim()) {
      alert("Please provide a reason for rejection");
      return;
    }

    const rejectionDetails: RejectionDetails = {
      reason: finalReason,
      notes: additionalNotes,
      rejectedBy: rejecterName,
      rejectedByEmail: rejecterEmail,
      rejectedAt: new Date().toISOString()
    };
    
    onConfirm(submission.id, rejectionDetails);
    resetForm();
    onClose();
  };

  const resetForm = () => {
    setRejectionReason("");
    setAdditionalNotes("");
    setCustomReason("");
    setShowCustomReason(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-800">Reject Submission</h2>
          <button
            onClick={() => {
              resetForm();
              onClose();
            }}
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

        {/* Rejection Reason */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Reason for Rejection <span className="text-red-500">*</span>
          </label>
          
          {!showCustomReason ? (
            <>
              <select
                value={rejectionReason}
                onChange={(e) => {
                  if (e.target.value === "Other") {
                    setShowCustomReason(true);
                    setRejectionReason("");
                  } else {
                    setRejectionReason(e.target.value);
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                required
              >
                <option value="">Select a reason...</option>
                <option value="Incomplete information">Incomplete information</option>
                <option value="Invalid file format">Invalid file format</option>
                <option value="File too large">File too large</option>
                <option value="Duplicate submission">Duplicate submission</option>
                <option value="Violation of guidelines">Violation of guidelines</option>
                <option value="Missing required documents">Missing required documents</option>
                <option value="Unclear or illegible content">Unclear or illegible content</option>
                <option value="Incorrect information provided">Incorrect information provided</option>
                <option value="File corrupted or unreadable">File corrupted or unreadable</option>
                <option value="Other">Other (specify below)</option>
              </select>
            </>
          ) : (
            <div>
              <textarea
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="Please specify the reason for rejection..."
                required
              />
              <button
                onClick={() => {
                  setShowCustomReason(false);
                  setCustomReason("");
                }}
                className="mt-2 text-sm text-blue-500 hover:text-blue-700"
              >
                ← Back to preset reasons
              </button>
            </div>
          )}
        </div>

        {/* Additional Notes */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Additional Notes / Explanation (Optional)
          </label>
          <textarea
            value={additionalNotes}
            onChange={(e) => setAdditionalNotes(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="Provide specific details about why this submission is being rejected. This will help the user understand what needs to be corrected.

Example:
- Missing signature on page 3
- Document is expired
- Name doesn't match ID
- Please resubmit with clearer scan"
          />
        </div>

        {/* Rejecter Information */}
        <div className="mb-6 p-3 bg-red-50 rounded-md border border-red-200">
          <h3 className="font-semibold text-gray-700 mb-2">Rejection Information</h3>
          {loading ? (
            <div className="text-gray-500">Loading...</div>
          ) : (
            <>
              <p className="text-sm text-gray-700"><strong>Rejected By:</strong> {rejecterName}</p>
              <p className="text-sm text-gray-700"><strong>Email:</strong> {rejecterEmail}</p>
              <p className="text-sm text-gray-700"><strong>Date & Time:</strong> {new Date().toLocaleString()}</p>
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleConfirm}
            className="flex-1 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
          >
            Confirm Rejection
          </button>
          <button
            onClick={() => {
              resetForm();
              onClose();
            }}
            className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}