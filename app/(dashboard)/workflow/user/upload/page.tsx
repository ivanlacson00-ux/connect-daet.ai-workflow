'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const supabase = createClient();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setMessage(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setMessage({ text: 'Please select a file first', type: 'error' });
      return;
    }

    setUploading(true);
    setMessage(null);

    try {
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (userError) {
        console.error('Auth error:', userError);
        setMessage({ text: `Auth error: ${userError.message}`, type: 'error' });
        return;
      }
      
      if (!user) {
        setMessage({ text: 'You must be logged in', type: 'error' });
        return;
      }

      // Check if profile exists
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (!profile) {
        await supabase
          .from('profiles')
          .insert({ id: user.id, email: user.email, role: 'user' });
      }

      // Upload file to storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('workflow_uploads')
        .upload(filePath, file);

      if (uploadError) {
        setMessage({ text: `Storage error: ${uploadError.message}`, type: 'error' });
        return;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('workflow_uploads')
        .getPublicUrl(filePath);

      // Save to database
      const { error: dbError } = await supabase
        .from('workflow_submissions')
        .insert({
          user_id: user.id,
          file_url: publicUrl,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type,
          status: 'pending_approver'
        });

      if (dbError) {
        setMessage({ text: `Database error: ${dbError.message}`, type: 'error' });
        return;
      }

      setMessage({ text: 'File uploaded successfully! Redirecting...', type: 'success' });
      setFile(null);
      
      setTimeout(() => {
        window.location.href = '/workflow/user';
      }, 1500);

    } catch (error: any) {
      setMessage({ text: `Unexpected error: ${error.message}`, type: 'error' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto py-12 px-6">
      {/* Header Section */}
      <div className="text-center mb-10">
        <h1 className="text-4xl font-black text-gray-900 tracking-tight mb-2">New Submission</h1>
        <p className="text-gray-500 font-medium">Upload your work for official review and points.</p>
      </div>
      
      {/* Main Upload Card */}
      <div className="bg-white rounded-[2.5rem] p-8 shadow-2xl shadow-blue-100/50 border border-gray-100">
        
        <div className={`relative group transition-all duration-500 rounded-[2rem] border-2 border-dashed p-12 flex flex-col items-center justify-center overflow-hidden
          ${file 
            ? 'border-blue-500 bg-blue-50/40 ring-4 ring-blue-50' 
            : 'border-gray-200 bg-gray-50 hover:bg-white hover:border-blue-400 hover:shadow-xl hover:shadow-blue-50'}`}
        >
          {/* Invisible Input covering the whole area */}
          <input
            id="file-input"
            type="file"
            onChange={handleFileChange}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
          />

          {!file ? (
            <>
              <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center text-3xl mb-6 shadow-lg shadow-blue-200 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300">
                <span className="text-white">📄</span>
              </div>
              <p className="text-xl font-bold text-gray-800">Select your file</p>
              <p className="text-sm text-gray-400 mt-2 font-semibold uppercase tracking-widest">Drag & Drop anywhere</p>
            </>
          ) : (
            <div className="flex flex-col items-center animate-in zoom-in duration-300">
              <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center text-white text-2xl mb-4 shadow-lg shadow-green-100">
                ✓
              </div>
              <p className="text-lg font-black text-gray-900 truncate max-w-xs">{file.name}</p>
              <p className="text-sm text-blue-600 font-bold mt-1">
                {(file.size / 1024 / 1024).toFixed(2)} MB • Ready
              </p>
              <button 
                onClick={(e) => { e.preventDefault(); setFile(null); }}
                className="mt-4 text-xs font-bold text-red-400 hover:text-red-600 uppercase tracking-tighter transition-colors z-30"
              >
                Remove File
              </button>
            </div>
          )}
        </div>

        {/* Dynamic Submission Button */}
        <div className="mt-8">
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className={`w-full py-5 rounded-2xl font-black text-lg transition-all flex items-center justify-center gap-3 shadow-xl active:scale-[0.97]
              ${!file || uploading 
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200 hover:shadow-blue-300'}`}
          >
            {uploading ? (
              <>
                <span className="w-6 h-6 border-4 border-white/20 border-t-white rounded-full animate-spin" />
                Uploading...
              </>
            ) : (
              'Submit to Workflow'
            )}
          </button>
          
          <button 
            onClick={() => window.history.back()}
            className="w-full mt-4 py-2 text-sm font-bold text-gray-400 hover:text-gray-600 transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>

      {/* Success/Error Feedback */}
      {message && (
        <div className={`mt-8 p-5 rounded-2xl border-2 flex items-center gap-4 animate-in slide-in-from-bottom-4 duration-500 ${
          message.type === 'success' 
            ? 'bg-green-50 border-green-100 text-green-800' 
            : 'bg-red-50 border-red-100 text-red-800'
        }`}>
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
            message.type === 'success' ? 'bg-green-200' : 'bg-red-200'
          }`}>
            {message.type === 'success' ? '✔️' : '⚠️'}
          </div>
          <p className="font-bold">{message.text}</p>
        </div>
      )}

      {/* Security Footer */}
      <div className="mt-12 text-center opacity-40 grayscale flex items-center justify-center gap-4">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">
          Encrypted Upload Channel • CONNECT-Daet.ai
        </span>
      </div>
    </div>
  );
}