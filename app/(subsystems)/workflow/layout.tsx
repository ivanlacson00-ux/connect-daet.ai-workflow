// src/app/(subsystems)/workflow/layout.tsx
export default function WorkflowLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="mb-8 text-2xl font-bold text-blue-600">
          📁 Workflow Portal
        </h1>
        {children}
      </div>
    </div>
  );
}