'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Html5Qrcode } from 'html5-qrcode';
import { createClient } from '@/lib/supabase/client';
import { isOfficeRole, OFFICE_CONFIG, type OfficeRole } from '@/lib/workflow/offices';

interface RetrievalDetails {
  submission_id: string;
  request_reference: string;
  document_title: string;
  requester_full_name: string;
  document_type: string | null;
  processing_status: string;
  office_role: string;
  retrieval_status: string;
  department_section: string | null;
  room: string | null;
  cabinet: string | null;
  shelf: string | null;
  drawer: string | null;
  folder_box: string | null;
  received_at: string | null;
  assigned_officer_name: string | null;
  latest_update: string;
  released_at: string | null;
  releasing_officer_name: string | null;
}

interface StorageLocation {
  department_section: string;
  room: string;
  cabinet: string;
  shelf: string;
  drawer: string;
  folder_box: string;
}

const EMPTY_LOCATION: StorageLocation = {
  department_section: '',
  room: '',
  cabinet: '',
  shelf: '',
  drawer: '',
  folder_box: '',
};

const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRetrievalToken(value: string) {
  const scannedValue = value.trim();
  let payload = scannedValue.replace(/^DAET-RETRIEVAL:/i, '');
  if (/^https?:\/\//i.test(scannedValue)) {
    try {
      const url = new URL(scannedValue);
      if (!url.pathname.replace(/\/+$/, '').endsWith('/workflow/retrieval')) return null;
      payload = new URLSearchParams(url.hash.slice(1)).get('token')
        || url.searchParams.get('token')
        || '';
    } catch {
      return null;
    }
  }
  return TOKEN_PATTERN.test(payload) ? payload : null;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}

export default function DocumentRetrievalPage() {
  const supabase = useMemo(() => createClient(), []);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scanHandledRef = useRef(false);
  const autoLookupAttemptedRef = useRef(false);
  const [officeRole, setOfficeRole] = useState<OfficeRole | null>(null);
  const [officerName, setOfficerName] = useState('');
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [details, setDetails] = useState<RetrievalDetails | null>(null);
  const [location, setLocation] = useState<StorageLocation>(EMPTY_LOCATION);
  const [identityVerified, setIdentityVerified] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner?.isScanning) return;
    try {
      await scanner.stop();
    } catch (error) {
      console.error('Could not stop the retrieval QR scanner:', error);
      setErrorMessage('The camera could not be stopped. Close the scanner and try again.');
    } finally {
      setCameraRunning(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const checkOfficerAccess = async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) {
        console.error('Retrieval officer authentication failed:', userError.message);
        if (active) setErrorMessage('Could not verify your account. Please sign in again.');
        if (active) setCheckingAccess(false);
        return;
      }
      if (!user) {
        if (active) setErrorMessage('Sign in with an authorized municipal officer account to use document retrieval.');
        if (active) setCheckingAccess(false);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', user.id)
        .single();
      if (profileError) {
        console.error('Retrieval officer profile load failed:', profileError.message);
        if (active) setErrorMessage('Could not verify your municipal office role.');
      } else if (isOfficeRole(profile?.role ?? null)) {
        if (active) {
          setOfficeRole(profile.role);
          setOfficerName(profile.full_name || '');
          setErrorMessage('');
        }
      } else if (active) {
        setErrorMessage('This feature is only available to authorized municipal office staff.');
      }
      if (active) setCheckingAccess(false);
    };

    void checkOfficerAccess();
    return () => {
      active = false;
      const scanner = scannerRef.current;
      if (scanner?.isScanning) {
        void scanner.stop().catch((error: unknown) => {
          console.error('Could not stop the retrieval QR scanner during cleanup:', error);
        });
      }
    };
  }, [supabase]);

  const lookupRetrieval = useCallback(async (value: string) => {
    const token = parseRetrievalToken(value);
    if (!token) {
      setErrorMessage('This does not look like a valid Docuflow retrieval QR code.');
      return;
    }

    setErrorMessage('');
    setMessage('');
    setDetails(null);
    const { data, error } = await supabase.rpc('get_workflow_retrieval_by_token', {
      scanned_token: token,
    });
    if (error) {
      console.error('Retrieval QR lookup failed:', error.message);
      setErrorMessage(error.message || 'Could not retrieve this request. Verify the QR code and office assignment.');
      return;
    }

    const record = Array.isArray(data) ? data[0] : data;
    if (!record) {
      setErrorMessage('No request was returned for this QR code.');
      return;
    }

    const retrieval: RetrievalDetails = record;
    setDetails(retrieval);
    setLocation({
      department_section: retrieval.department_section || '',
      room: retrieval.room || '',
      cabinet: retrieval.cabinet || '',
      shelf: retrieval.shelf || '',
      drawer: retrieval.drawer || '',
      folder_box: retrieval.folder_box || '',
    });
    setIdentityVerified(false);
  }, [supabase]);

  useEffect(() => {
    if (!officeRole || autoLookupAttemptedRef.current) return;
    const url = new URL(window.location.href);
    const token = new URLSearchParams(url.hash.slice(1)).get('token')
      || url.searchParams.get('token');
    if (!token) return;

    autoLookupAttemptedRef.current = true;
    window.history.replaceState(null, '', url.pathname);
    setManualCode(token);
    void lookupRetrieval(token);
  }, [officeRole, lookupRetrieval]);

  const startCamera = async () => {
    setCameraStarting(true);
    setErrorMessage('');
    scanHandledRef.current = false;
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      const scanner = new Html5Qrcode('retrieval-qr-reader', {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          if (scanHandledRef.current) return;
          scanHandledRef.current = true;
          await stopCamera();
          await lookupRetrieval(decodedText);
        },
        () => undefined
      );
      setCameraRunning(true);
    } catch (error) {
      console.error('Retrieval QR camera could not start:', error);
      setErrorMessage(error instanceof Error
        ? `Could not start the camera: ${error.message}`
        : 'Could not start the camera. Check camera permission and try again.');
      const scanner = scannerRef.current;
      if (scanner?.isScanning) {
        await scanner.stop().catch((stopError: unknown) => {
          console.error('Could not stop the failed camera scanner:', stopError);
        });
      }
    } finally {
      setCameraStarting(false);
    }
  };

  const saveLocation = async () => {
    if (!details) return;
    setSavingLocation(true);
    setErrorMessage('');
    setMessage('');
    try {
      const { error } = await supabase.rpc('update_workflow_document_location', {
        target_submission_id: details.submission_id,
        location_department_section: location.department_section,
        location_room: location.room,
        location_cabinet: location.cabinet,
        location_shelf: location.shelf,
        location_drawer: location.drawer,
        location_folder_box: location.folder_box,
      });
      if (error) throw error;

      const updatedAt = new Date().toISOString();
      setDetails((current) => current ? {
        ...current,
        ...location,
        received_at: current.received_at || updatedAt,
        assigned_officer_name: officerName || current.assigned_officer_name,
        latest_update: updatedAt,
      } : current);
      setMessage('Physical storage location saved.');
    } catch (error) {
      console.error('Physical document location update failed:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Could not save the storage location.');
    } finally {
      setSavingLocation(false);
    }
  };

  const confirmRelease = async () => {
    if (!details || !identityVerified) return;
    setReleasing(true);
    setErrorMessage('');
    setMessage('');
    try {
      const { data, error } = await supabase.rpc('release_workflow_document', {
        target_submission_id: details.submission_id,
        requester_identity_verified: true,
      });
      if (error) throw error;
      const release = Array.isArray(data) ? data[0] : data;
      if (!release?.released_at) {
        throw new Error('The system did not confirm the document release.');
      }
      setDetails((current) => current ? {
        ...current,
        processing_status: 'Released',
        retrieval_status: 'released',
        released_at: release.released_at,
        releasing_officer_name: release.releasing_officer_name || officerName,
        latest_update: release.released_at,
      } : current);
      setMessage('Document handover recorded. The requester has been notified.');
      setIdentityVerified(false);
    } catch (error) {
      console.error('Document release confirmation failed:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Could not record this document release.');
    } finally {
      setReleasing(false);
    }
  };

  const officeLabel = details && isOfficeRole(details.office_role)
    ? OFFICE_CONFIG[details.office_role].label
    : 'Municipal office';

  if (checkingAccess) {
    return (
      <div className="rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
        Verifying municipal officer access...
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header>
        <p className="mb-2 text-[11px] font-medium text-muted-text">Authorized officer workspace</p>
        <h1 className="font-serif text-[32px] leading-tight text-warm-text max-md:text-[26px]">
          Scan QR Code
        </h1>
        <p className="mt-2 text-xs text-muted-text">
          Scan a requester’s retrieval code to locate and record handover of the physical document.
        </p>
      </header>

      {!officeRole ? (
        <p role="alert" className="rounded-2xl border border-rejected-bg bg-rejected-bg/50 p-4 text-xs text-rejected-text">
          {errorMessage || 'This feature is only available to authorized municipal office staff.'}
        </p>
      ) : (
        <>
          <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <p className="mb-4 text-xs font-semibold text-warm-text">{OFFICE_CONFIG[officeRole].label}</p>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(16rem,0.7fr)]">
              <div>
                <div
                  id="retrieval-qr-reader"
                  className="min-h-64 overflow-hidden rounded-xl border border-warm-border bg-cream"
                />
                <div className="mt-3 flex gap-2">
                  {!cameraRunning ? (
                    <button
                      type="button"
                      onClick={() => void startCamera()}
                      disabled={cameraStarting}
                      className="inline-flex h-10 flex-1 items-center justify-center rounded-full bg-clay px-4 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {cameraStarting ? 'Starting camera...' : 'Start camera scanner'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void stopCamera()}
                      className="inline-flex h-10 flex-1 items-center justify-center rounded-full border border-warm-border px-4 text-xs font-semibold text-warm-text"
                    >
                      Stop camera
                    </button>
                  )}
                </div>
              </div>
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void lookupRetrieval(manualCode);
                }}
              >
                <label htmlFor="manual-retrieval-code" className="block text-xs font-semibold text-warm-text">
                  Enter QR code text
                </label>
                <input
                  id="manual-retrieval-code"
                  value={manualCode}
                  onChange={(event) => setManualCode(event.target.value)}
                  placeholder="Paste a QR link or token"
                  className="h-10 w-full rounded-xl border border-warm-border bg-white px-3 text-xs text-warm-text outline-none focus:border-clay"
                />
                <button
                  type="submit"
                  disabled={!manualCode.trim()}
                  className="h-10 w-full rounded-full border border-warm-border text-xs font-semibold text-warm-text disabled:opacity-50"
                >
                  Retrieve request
                </button>
                <p className="text-[10px] leading-relaxed text-muted-text">
                  The QR code opens this retrieval page with a random identifier only. Request details are returned only to the assigned office.
                </p>
              </form>
            </div>
          </section>

          {errorMessage && (
            <p role="alert" className="rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs text-rejected-text">
              {errorMessage}
            </p>
          )}
          {message && (
            <p role="status" className="rounded-xl border border-approved-bg bg-approved-bg/50 px-4 py-3 text-xs text-approved-text">
              {message}
            </p>
          )}

          {details && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
              <section className="space-y-4 rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-warm-border pb-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-text">Request reference</p>
                    <p className="mt-1 font-mono text-lg font-bold text-clay">{details.request_reference}</p>
                    <h2 className="mt-2 break-words font-serif text-2xl text-warm-text">{details.document_title}</h2>
                    <a
                      href={`/api/workflow/files/${encodeURIComponent(details.submission_id)}?redirect=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex h-10 items-center justify-center rounded-full bg-clay px-4 text-xs font-semibold text-white hover:bg-warm-text"
                    >
                      Open digital document
                    </a>
                  </div>
                  <span className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                    details.retrieval_status === 'released'
                      ? 'bg-approved-bg text-approved-text'
                      : 'bg-pending-bg text-pending-text'
                  }`}>
                    {details.retrieval_status === 'released' ? 'Released' : details.processing_status.replaceAll('_', ' ')}
                  </span>
                </div>

                <dl className="grid gap-3 sm:grid-cols-2">
                  <div><dt className="text-[10px] text-muted-text">Requester</dt><dd className="mt-1 text-xs font-semibold text-warm-text">{details.requester_full_name}</dd></div>
                  <div><dt className="text-[10px] text-muted-text">Document type</dt><dd className="mt-1 text-xs font-semibold text-warm-text">{details.document_type || 'Not specified'}</dd></div>
                  <div><dt className="text-[10px] text-muted-text">Assigned municipal office</dt><dd className="mt-1 text-xs font-semibold text-warm-text">{officeLabel}</dd></div>
                  <div><dt className="text-[10px] text-muted-text">Assigned / responsible officer</dt><dd className="mt-1 text-xs font-semibold text-warm-text">{details.assigned_officer_name || 'Not assigned'}</dd></div>
                  <div><dt className="text-[10px] text-muted-text">Date received by office</dt><dd className="mt-1 text-xs font-semibold text-warm-text">{formatDate(details.received_at)}</dd></div>
                  <div><dt className="text-[10px] text-muted-text">Latest update</dt><dd className="mt-1 text-xs font-semibold text-warm-text">{formatDate(details.latest_update)}</dd></div>
                </dl>

                <div className="rounded-2xl border-2 border-clay/40 bg-clay-soft p-4">
                  <h3 className="text-xs font-bold text-clay">Physical document storage location</h3>
                  <p className="mt-1 text-[10px] text-muted-text">{officeLabel}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {[
                      ['Department / Section', details.department_section],
                      ['Room', details.room],
                      ['Cabinet', details.cabinet],
                      ['Shelf', details.shelf],
                      ['Drawer', details.drawer],
                      ['Folder / Box', details.folder_box],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-[10px] text-muted-text">{label}</dt>
                        <dd className="mt-1 break-words text-xs font-semibold text-warm-text">{value || 'Not recorded'}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </section>

              <section className="space-y-4 rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
                <h2 className="text-sm font-semibold text-warm-text">Storage and handover</h2>
                <fieldset disabled={details.retrieval_status === 'released'} className="space-y-3 disabled:opacity-60">
                  {([
                    ['department_section', 'Department / Section'],
                    ['room', 'Room'],
                    ['cabinet', 'Cabinet'],
                    ['shelf', 'Shelf'],
                    ['drawer', 'Drawer'],
                    ['folder_box', 'Folder / Box'],
                  ] as const).map(([field, label]) => (
                    <label key={field} className="block text-[10px] font-medium text-muted-text">
                      {label}
                      <input
                        value={location[field]}
                        onChange={(event) => setLocation((current) => ({ ...current, [field]: event.target.value }))}
                        maxLength={200}
                        className="mt-1 h-9 w-full rounded-lg border border-warm-border bg-white px-3 text-xs text-warm-text outline-none focus:border-clay"
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    onClick={() => void saveLocation()}
                    disabled={savingLocation || details.retrieval_status === 'released'}
                    className="h-10 w-full rounded-full border border-warm-border text-xs font-semibold text-warm-text disabled:opacity-50"
                  >
                    {savingLocation ? 'Saving location...' : 'Save physical location'}
                  </button>
                </fieldset>

                {details.retrieval_status === 'released' ? (
                  <div className="rounded-xl bg-approved-bg p-3 text-xs text-approved-text">
                    Released {formatDate(details.released_at)}
                    {details.releasing_officer_name ? ` by ${details.releasing_officer_name}` : ''}.
                  </div>
                ) : (
                  <div className="space-y-3 border-t border-warm-border pt-4">
                    <label className="flex items-start gap-2 text-[11px] leading-relaxed text-warm-text">
                      <input
                        type="checkbox"
                        checked={identityVerified}
                        onChange={(event) => setIdentityVerified(event.target.checked)}
                        className="mt-0.5 accent-[#df7958]"
                      />
                      I verified the requester’s identity and authorization in person.
                    </label>
                    <button
                      type="button"
                      onClick={() => void confirmRelease()}
                      disabled={!identityVerified || releasing}
                      className="h-11 w-full rounded-full bg-clay px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {releasing ? 'Recording handover...' : 'Confirm document handover'}
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
