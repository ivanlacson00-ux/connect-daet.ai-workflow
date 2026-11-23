'use client';
import { logClientError } from '@/lib/clientLogger';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Html5Qrcode } from 'html5-qrcode';
import { createClient } from '@/lib/supabase/client';
import { isOfficeRole, OFFICE_CONFIG, type OfficeRole } from '@/lib/workflow/offices';
import { useWorkflowAutoRefresh } from '@/lib/workflow/useWorkflowAutoRefresh';
import { useWorkflowAccount } from '@/lib/workflow/role-context';
import Icon from '@/components/ui/Icon';
import PageHero from '@/components/ui/PageHero';

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

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

export default function DocumentRetrievalPage() {
  const supabase = useMemo(() => createClient(), []);
  const { role, userId, fullName, ready } = useWorkflowAccount();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scanHandledRef = useRef(false);
  const autoLookupAttemptedRef = useRef(false);
  const activeLookupValueRef = useRef('');
  const [officeRole, setOfficeRole] = useState<OfficeRole | null>(null);
  const [officerName, setOfficerName] = useState('');
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [details, setDetails] = useState<RetrievalDetails | null>(null);
  const [location, setLocation] = useState<StorageLocation>(EMPTY_LOCATION);
  const [locationEditEnabled, setLocationEditEnabled] = useState(false);
  const [canMoveStoredLocation, setCanMoveStoredLocation] = useState(false);
  const [identityVerified, setIdentityVerified] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const hasRecordedLocation = Boolean(
    details?.department_section?.trim()
    || details?.shelf?.trim()
    || details?.folder_box?.trim()
  );
  const hasCompleteLocation = Boolean(
    details?.department_section?.trim()
    && details?.shelf?.trim()
    && details?.folder_box?.trim()
  );
  const hasCompleteLocationInput = [
    location.department_section,
    location.shelf,
    location.folder_box,
  ].every((value) => value.trim());
  const locationNeedsSaving = Boolean(
    locationEditEnabled
    || location.department_section.trim() !== (details?.department_section || '').trim()
    || location.shelf.trim() !== (details?.shelf || '').trim()
    || location.folder_box.trim() !== (details?.folder_box || '').trim()
  );
  const storageLocationLocked = canMoveStoredLocation && !locationEditEnabled;
  const identityVerificationDisabled = !details
    || Boolean(details.released_at)
    || releasing
    || savingLocation
    || !hasCompleteLocation
    || locationNeedsSaving
    || (canMoveStoredLocation && !locationEditEnabled);

  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner?.isScanning) return;
    try {
      await scanner.stop();
    } catch (error) {
      logClientError('Could not stop the retrieval QR scanner:', error);
      setErrorMessage('The camera could not be stopped. Close the scanner and try again.');
    } finally {
      setCameraRunning(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;

    let active = true;
    const checkOfficerAccess = async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) {
        logClientError('Retrieval officer authentication failed:', userError.message);
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
        logClientError('Retrieval officer profile load failed:', profileError.message);
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

    void checkOfficerAccess().catch((error: unknown) => {
      logClientError('Retrieval officer access check failed:', error);
      if (active) {
        setErrorMessage('Could not verify your municipal office role. Please try again.');
        setCheckingAccess(false);
      }
    });

    return () => {
      const scanner = scannerRef.current;
      if (scanner?.isScanning) {
        void scanner.stop().catch((error: unknown) => {
          logClientError('Could not stop the retrieval QR scanner during cleanup:', error);
        });
      }
    };
  }, [fullName, ready, role, userId]);

  const lookupRetrieval = useCallback(async (value: string, background = false) => {
    const token = parseRetrievalToken(value);
    const lookupValue = value.trim();
    const looksLikeQr = /^DAET-RETRIEVAL:/i.test(lookupValue) || /^https?:\/\//i.test(lookupValue);
    if (!token && looksLikeQr) {
      setErrorMessage('This does not look like a valid retrieval QR code.');
      return;
    }
    if (!token && !lookupValue) {
      setErrorMessage('Enter the tracking number or scan the requester’s retrieval QR code.');
      return;
    }

    if (!background) {
      activeLookupValueRef.current = '';
      setErrorMessage('');
      setMessage('');
      setDetails(null);
      setLocationEditEnabled(false);
      setCanMoveStoredLocation(false);
    }
    const { data, error } = token
      ? await supabase.rpc('get_workflow_retrieval_by_token', {
          scanned_token: token,
        })
      : await supabase.rpc('get_workflow_retrieval_by_tracking_number', {
          search_tracking_number: lookupValue,
        });
    if (error) {
      logClientError('Retrieval QR lookup failed:', error.message);
      setErrorMessage(error.message || 'Could not retrieve this request. Verify the QR code and office assignment.');
      return;
    }

    const record = Array.isArray(data) ? data[0] : data;
    if (!record) {
      setErrorMessage('No request was returned. Verify the tracking number and office assignment.');
      return;
    }

    const retrieval: RetrievalDetails = record;
    setDetails(retrieval);
    if (!background) {
      setCanMoveStoredLocation(Boolean(
        retrieval.department_section?.trim()
        || retrieval.shelf?.trim()
        || retrieval.folder_box?.trim()
      ));
    }
    if (!background || !locationEditEnabled) {
      setLocation({
        department_section: retrieval.department_section || '',
        room: '',
        cabinet: '',
        shelf: retrieval.shelf || '',
        drawer: '',
        folder_box: '',
      });
    }
    if (!background) {
      setIdentityVerified(false);
      setLocationEditEnabled(false);
    }
    activeLookupValueRef.current = value.trim();
    setErrorMessage('');
  }, [locationEditEnabled, supabase]);

  useWorkflowAutoRefresh(
    supabase,
    () => {
      if (activeLookupValueRef.current) {
        void lookupRetrieval(activeLookupValueRef.current, true);
      }
    },
  );

  useEffect(() => {
    if (!officeRole || autoLookupAttemptedRef.current) return;
    const url = new URL(window.location.href);
    const token = new URLSearchParams(url.hash.slice(1)).get('token')
      || url.searchParams.get('token');
    if (!token) return;

    autoLookupAttemptedRef.current = true;
    window.history.replaceState(null, '', url.pathname);
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
      logClientError('Retrieval QR camera could not start:', error);
      setErrorMessage(error instanceof Error
        ? `Could not start the camera: ${error.message}`
        : 'Could not start the camera. Check camera permission and try again.');
      const scanner = scannerRef.current;
      if (scanner?.isScanning) {
        await scanner.stop().catch((stopError: unknown) => {
          logClientError('Could not stop the failed camera scanner:', stopError);
        });
      }
    } finally {
      setCameraStarting(false);
    }
  };

  const saveLocation = async () => {
    if (!details) return;
    if (storageLocationLocked) return;
    if ([location.department_section, location.shelf, location.folder_box].some((value) => !value.trim())) {
      setErrorMessage('Enter the department / room, shelf, and folder / box before saving the storage location.');
      return;
    }
    setSavingLocation(true);
    setErrorMessage('');
    setMessage('');
    try {
      const { error } = await supabase.rpc('update_workflow_document_location', {
        target_submission_id: details.submission_id,
        location_department_section: location.department_section,
        location_room: '',
        location_cabinet: '',
        location_shelf: location.shelf,
        location_drawer: '',
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
      logClientError('Physical document location update failed:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Could not save the storage location.');
    } finally {
      setSavingLocation(false);
    }
  };

  const confirmRelease = async () => {
    if (!details) return;
    if (details.released_at) {
      setErrorMessage('This document has already been handed over.');
      return;
    }
    if (canMoveStoredLocation && !locationEditEnabled) {
      setErrorMessage('Check “Move the document to a new storage location” before verifying identity and recording handover.');
      return;
    }
    if (!hasCompleteLocation || locationNeedsSaving) {
      setErrorMessage('Enter and save all three storage location fields before recording handover.');
      return;
    }
    if (!identityVerified) return;
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
        processing_status: 'Released copy',
        retrieval_status: 'released',
        released_at: release.released_at,
        releasing_officer_name: release.releasing_officer_name || officerName,
        latest_update: release.released_at,
      } : current);
      setMessage('Document handover recorded and ready for claim.');
      setIdentityVerified(false);
      setLocationEditEnabled(false);
    } catch (error) {
      logClientError('Document release confirmation failed:', error);
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
      <PageHero
        greet={false}
        className="mb-0"
        eyebrow="Authorized officer workspace"
        icon="qr"
        title="Scan QR Code"
        description="Scan a requester’s retrieval code to locate and record handover of the physical document."
      />

      {!officeRole ? (
        <p role="alert" className="rounded-2xl border border-rejected-bg bg-rejected-bg/50 p-4 text-xs text-rejected-text">
          {errorMessage || 'This feature is only available to authorized municipal office staff.'}
        </p>
      ) : (
        <>
          <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <p className="mb-4 flex items-center gap-2 text-xs font-semibold text-warm-text">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-clay-soft text-clay"><Icon name="building" size={15} /></span>
              {OFFICE_CONFIG[officeRole].label}
            </p>
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
                      className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-clay px-4 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:opacity-50"
                    >
                      <Icon name={cameraStarting ? 'refresh' : 'scan'} size={15} className={cameraStarting ? 'animate-spin motion-reduce:animate-none' : ''} />
                      {cameraStarting ? 'Starting camera...' : 'Start camera scanner'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void stopCamera()}
                      className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full border border-warm-border px-4 text-xs font-semibold text-warm-text transition-colors hover:bg-sidebar"
                    >
                      <Icon name="x" size={15} /> Stop camera
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
                  Enter the tracking number
                </label>
                <input
                  id="manual-retrieval-code"
                  value={manualCode}
                  onChange={(event) => setManualCode(event.target.value)}
                  placeholder="Enter tracking number"
                  className="h-10 w-full rounded-xl border border-warm-border bg-white px-3 text-xs text-warm-text outline-none focus:border-clay"
                />
                <button
                  type="submit"
                  disabled={!manualCode.trim()}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-warm-border text-xs font-semibold text-warm-text transition-colors hover:bg-sidebar disabled:opacity-50"
                >
                  <Icon name="search" size={14} /> Retrieve request
                </button>
                <p className="text-[10px] leading-relaxed text-muted-text">
                  Request details are returned only to the assigned office. A retrieval record must be active for the tracking number.
                </p>
              </form>
            </div>
          </section>

          {errorMessage && (
            <p role="alert" className="ui-fade-up flex items-start gap-2 rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs text-rejected-text">
              <Icon name="alert" size={15} className="mt-px shrink-0" />
              <span>{errorMessage}</span>
            </p>
          )}
          {message && (
            <p role="status" className="ui-fade-up flex items-start gap-2 rounded-xl border border-approved-bg bg-approved-bg/50 px-4 py-3 text-xs text-approved-text">
              <Icon name="check" size={15} className="mt-px shrink-0" />
              <span>{message}</span>
            </p>
          )}

          {details && (
            <div className="ui-stagger grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
              <section className="space-y-4 rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-warm-border pb-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-text">Tracking Number</p>
                    <p className="mt-1 font-mono text-lg font-bold text-clay">{details.request_reference}</p>
                    <h2 className="mt-2 break-words font-serif text-2xl text-warm-text">{details.document_title}</h2>
                    <a
                      href={`/api/workflow/files/${encodeURIComponent(details.submission_id)}?redirect=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-full bg-clay px-4 text-xs font-semibold text-white hover:bg-warm-text"
                    >
                      <Icon name="file" size={15} /> Open digital document
                    </a>
                  </div>
                  <span className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                    'bg-pending-bg text-pending-text'
                  }`}>
                    {details.processing_status.replaceAll('_', ' ')}
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
                  <h3 className="flex items-center gap-2 text-xs font-bold text-clay"><Icon name="map-pin" size={15} /> Physical document storage location</h3>
                  <p className="mt-1 text-[10px] text-muted-text">{officeLabel}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {[
                      ['Department / Room', details.department_section],
                      ['Shelf', details.shelf],
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
                <h2 className="flex items-center gap-2 text-sm font-semibold text-warm-text"><Icon name="archive" size={16} className="text-clay" /> Storage and handover</h2>
                <div className={`flex items-center gap-2 rounded-xl px-3 py-3 text-xs ${
                  details.received_at
                    ? 'bg-approved-bg text-approved-text'
                    : 'bg-pending-bg text-pending-text'
                }`}>
                  <Icon name={details.received_at ? 'check' : 'clock'} size={15} className="shrink-0" />
                  {details.received_at
                    ? `Physical copy stored ${formatDate(details.received_at)}`
                    : locationNeedsSaving && hasCompleteLocationInput
                      ? 'Location entered but not saved. Select Save to record it.'
                      : locationNeedsSaving || hasRecordedLocation
                        ? 'Complete all three storage location fields and save them.'
                        : 'Physical storage location is not recorded'}
                </div>
                {canMoveStoredLocation && (
                  <label className="flex items-start gap-2 text-[11px] leading-relaxed text-warm-text">
                    <input
                      type="checkbox"
                      checked={locationEditEnabled}
                      disabled={savingLocation}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setLocationEditEnabled(enabled);
                        setIdentityVerified(false);
                        setLocation(enabled ? EMPTY_LOCATION : {
                          department_section: details.department_section || '',
                          room: '',
                          cabinet: '',
                          shelf: details.shelf || '',
                          drawer: '',
                          folder_box: details.folder_box || '',
                        });
                        setErrorMessage('');
                        setMessage('');
                      }}
                      className="mt-0.5 accent-[#df7958] disabled:opacity-50"
                    />
                    Move the document to a new storage location
                  </label>
                )}
                {canMoveStoredLocation && locationEditEnabled && (
                  <p className="text-[10px] leading-relaxed text-muted-text">
                    Enter all three fields for the new storage location before saving.
                  </p>
                )}
                <fieldset className="space-y-3" disabled={storageLocationLocked || savingLocation}>
                  {([
                    ['department_section', 'Department / Room'],
                    ['shelf', 'Shelf'],
                    ['folder_box', 'Folder / Box'],
                  ] as const).map(([field, label]) => (
                    <label key={field} className="block text-[10px] font-medium text-muted-text">
                      {label}
                      <input
                        value={location[field]}
                        onChange={(event) => {
                          setLocation((current) => ({ ...current, [field]: event.target.value }));
                          setIdentityVerified(false);
                        }}
                        maxLength={200}
                        className="mt-1 h-9 w-full rounded-lg border border-warm-border bg-white px-3 text-xs text-warm-text outline-none focus:border-clay disabled:cursor-not-allowed disabled:bg-sidebar disabled:text-muted-text"
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    onClick={() => void saveLocation()}
                    disabled={savingLocation}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-warm-border text-xs font-semibold text-warm-text transition-colors hover:bg-sidebar disabled:opacity-50"
                  >
                    <Icon name={savingLocation ? 'refresh' : 'map-pin'} size={14} className={savingLocation ? 'animate-spin motion-reduce:animate-none' : ''} />
                    {savingLocation ? 'Saving location...' : 'Save physical location'}
                  </button>
                </fieldset>

                <div className="space-y-3 border-t border-warm-border pt-4">
                    <label className="flex items-start gap-2 text-[11px] leading-relaxed text-warm-text">
                      <input
                        type="checkbox"
                        checked={identityVerified}
                        disabled={identityVerificationDisabled}
                        onChange={(event) => setIdentityVerified(event.target.checked)}
                        className="mt-0.5 accent-[#df7958] disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      I verified the requester’s identity and authorization in person.
                    </label>
                    <button
                      type="button"
                      onClick={() => void confirmRelease()}
                      disabled={!identityVerified || !details.received_at || releasing}
                      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-clay px-4 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Icon name={releasing ? 'refresh' : 'file-check'} size={15} className={releasing ? 'animate-spin motion-reduce:animate-none' : ''} />
                      {releasing ? 'Recording handover...' : 'Confirm copy handover'}
                    </button>
                  </div>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
