// src/app/(subsystems)/workflow/upload/page.tsx
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

      console.log('Current user:', user.id, user.email);

      // Check if profile exists
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      console.log('Profile check:', profile, profileError);

      if (!profile) {
        // Create profile if it doesn't exist
        console.log('Creating profile for user...');
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({ id: user.id, email: user.email, role: 'user' });

        if (insertError) {
          console.error('Profile creation error:', insertError);
          setMessage({ text: `Failed to create profile: ${insertError.message}`, type: 'error' });
          return;
        }
        console.log('Profile created successfully');
      }

      // Upload file to storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      console.log('Uploading to storage:', filePath);

      const { error: uploadError } = await supabase.storage
        .from('workflow_uploads')
        .upload(filePath, file);

      if (uploadError) {
        console.error('Storage upload error:', uploadError);
        setMessage({ text: `Storage error: ${uploadError.message}`, type: 'error' });
        return;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('workflow_uploads')
        .getPublicUrl(filePath);

      console.log('File uploaded, URL:', publicUrl);

      // Save to database - using a direct insert with no RLS dependency
      const { data: insertData, error: dbError } = await supabase
        .from('workflow_submissions')
        .insert({
          user_id: user.id,
          file_url: publicUrl,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type,
          status: 'pending_approver'
        })
        .select();

      if (dbError) {
        console.error('Database insert error:', dbError);
        setMessage({ text: `Database error: ${dbError.message}`, type: 'error' });
        return;
      }

      console.log('Database insert successful:', insertData);

      setMessage({ text: 'File uploaded successfully!', type: 'success' });
      setFile(null);
      
      // Reset file input
      const fileInput = document.getElementById('file-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';

    } catch (error: any) {
      console.error('Unexpected error:', error);
      setMessage({ text: `Unexpected error: ${error.message}`, type: 'error' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">Upload New File</h2>
      
      <div className="rounded-2xl border-2 border-dashed border-gray-300 p-8 text-center">
        <input
          id="file-input"
          type="file"
          onChange={handleFileChange}
          className="mb-4 block w-full text-sm text-gray-500
            file:mr-4 file:py-2 file:px-4
            file:rounded-full file:border-0
            file:text-sm file:font-semibold
            file:bg-blue-50 file:text-blue-700
            hover:file:bg-blue-100"
        />
        
        {file && (
          <div className="mt-4 p-3 bg-gray-50 rounded-lg">
            <p className="font-medium">{file.name}</p>
            <p className="text-sm text-gray-500">
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </div>
        )}
        
        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="mt-6 rounded-full bg-blue-600 px-8 py-3 text-white font-semibold
            hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors"
        >
          {uploading ? 'Uploading...' : 'Upload File'}
        </button>
        
        {message && (
          <div className={`mt-4 p-3 rounded-lg text-left ${
            message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            <strong>{message.type === 'success' ? '✓' : '✗'}</strong> {message.text}
          </div>
        )}
      </div>
    </div>
  );
}