'use client';

import { useState, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

const fonts = {
  serif: "font-serif italic", 
  mono: "font-mono uppercase tracking-[0.2em] text-[10px]",
};

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      if (!title) setTitle(selectedFile.name.split('.')[0]);
      setMessage(null);
    }
  };

  const handleUpload = async () => {
    if (!file || !title) {
      setMessage({ text: 'Incomplete Manifest: Title and File required.', type: 'error' });
      return;
    }

    setUploading(true);
    setMessage(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Auth Session Expired");

      // 1. Upload to Storage
      const fileExt = file.name.split('.').pop();
      const filePath = `${user.id}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('workflow_uploads')
        .upload(filePath, file, {
          contentType: file.type,
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('workflow_uploads')
        .getPublicUrl(filePath);

      // FIX: Ensure the database record has the extension in the name
      const fileNameWithExt = title.toLowerCase().endsWith(`.${fileExt?.toLowerCase()}`) 
        ? title 
        : `${title}.${fileExt}`;

      // 2. Insert Record
      const { error: dbError } = await supabase
        .from('workflow_submissions')
        .insert({
          user_id: user.id,
          file_url: publicUrl,
          file_name: fileNameWithExt, 
          file_size: file.size,
          file_type: file.type,
          status: 'pending'
        });

      if (dbError) throw dbError;

      setMessage({ text: 'Data Logged Successfully. Redirecting...', type: 'success' });
      setTimeout(() => router.push('/workflow/user'), 1500);

    } catch (error: any) {
      console.error("Upload Error:", error);
      setMessage({ text: error.message, type: 'error' });
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fcfcfc] text-black py-20 px-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-16 border-b-2 border-black pb-8">
          <div className="flex justify-between items-end">
            <div>
              <span className={`${fonts.mono} text-blue-600 font-bold`}>System_Entry // Inbound_File</span>
              <h1 className={`${fonts.serif} text-6xl mt-2 text-black`}>New Log</h1>
            </div>
            <button onClick={() => router.back()} className={`${fonts.mono} text-black hover:text-blue-600 transition-colors mb-2 font-bold`}>
              [ Cancel_Exit ]
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-7 space-y-10">
            <section>
              <label className={`${fonts.mono} text-black font-bold block mb-3`}>01. Document_Title</label>
              <input 
                type="text" 
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Name your submission..."
                className="w-full bg-white border-b-2 border-black/20 focus:border-blue-600 py-4 text-2xl font-serif italic outline-none transition-all placeholder:text-gray-300 text-black"
              />
            </section>

            <div className="grid grid-cols-2 gap-8">
              <section>
                <label className={`${fonts.mono} text-black font-bold block mb-3`}>02. Department</label>
                <select 
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={`${fonts.mono} w-full bg-gray-50 border-2 border-black/20 p-4 focus:border-blue-600 outline-none cursor-pointer text-black font-bold`}
                >
                  <option value="General">General</option>
                  <option value="Tourism">Tourism</option>
                  <option value="Events">Events</option>
                </select>
              </section>
              <div className="flex items-center">
                 <p className="text-[9px] font-mono leading-relaxed text-black uppercase tracking-tighter font-bold opacity-40">
                   *Note: Category and Brief are currently not logged to database.
                 </p>
              </div>
            </div>

            <section>
              <label className={`${fonts.mono} text-black font-bold block mb-3`}>03. Context_Brief</label>
              <textarea 
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Internal notes (not saved)..."
                className="w-full bg-gray-50 border-2 border-black/20 p-6 focus:border-blue-600 outline-none transition-all font-medium text-black resize-none"
              />
            </section>
          </div>

          <div className="lg:col-span-5">
            <div className="sticky top-10 space-y-6">
              <label className={`${fonts.mono} text-black font-bold block`}>04. Source_File</label>
              <div 
                onClick={() => fileInputRef.current?.click()}
                className={`group relative aspect-square border-2 border-dashed flex flex-col items-center justify-center p-8 transition-all cursor-pointer overflow-hidden
                  ${file ? 'border-blue-600 bg-blue-50/30' : 'border-black/20 hover:border-black bg-gray-50'}`}
              >
                <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                {!file ? (
                  <>
                    <div className="w-16 h-16 border-2 border-black/20 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 group-hover:border-black transition-all">
                      <span className="text-2xl text-black font-bold">↑</span>
                    </div>
                    <span className={`${fonts.mono} text-black font-bold text-center`}>Initialize<br/>Upload</span>
                  </>
                ) : (
                  <div className="text-center animate-in zoom-in-95 duration-300">
                    <div className="text-5xl mb-4">📄</div>
                    <p className={`${fonts.mono} text-blue-600 font-bold break-all`}>{file.name}</p>
                    <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="mt-6 text-[9px] font-mono text-red-600 border border-red-200 px-3 py-1 hover:bg-red-50 font-bold">
                      [ Remove ]
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={handleUpload}
                disabled={uploading || !file}
                className={`${fonts.mono} w-full py-6 text-white text-sm font-black transition-all shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none
                  ${uploading || !file ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none' : 'bg-blue-600 hover:bg-black'}`}
              >
                {uploading ? 'SYNCING...' : 'EXECUTE_SUBMISSION →'}
              </button>

              {message && (
                <div className={`p-4 border-l-4 ${message.type === 'success' ? 'bg-green-50 border-green-600 text-green-900' : 'bg-red-50 border-red-600 text-red-900'}`}>
                  <p className={`${fonts.mono} text-[11px] font-bold`}>STATUS: {message.type.toUpperCase()}</p>
                  <p className="text-sm mt-1 font-bold">{message.text}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}