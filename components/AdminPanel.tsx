import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, Trash2, Plus, Edit2, Save, X as XIcon, Lock, Unlock, 
  Sparkles, Image as ImageIcon, Link as LinkIcon, Download, 
  Terminal, Shield, AlertTriangle, CheckCircle, PlayCircle, Loader,
  TrendingUp, Key, Fingerprint, FileSearch, Code
} from 'lucide-react';
import { useMockData } from '../services/mockData';
import { Profile, Image, MediaType } from '../types';
// Types for the Automation AI Scraper
interface ScrapeCandidate {
  id: string;
  originalUrl: string;
  processedUrl: string;
  mediaType: MediaType;
  contentType: string;
  size: string;
  status: 'pending' | 'success' | 'skipped' | 'error';
  reason?: string;
  caption?: string;
}

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

interface AutomationReport {
  profileHandle: string;
  profileId?: string;
  operation: string;
  dryRun: boolean;
  attemptedCount?: number;
  requestedCount?: number;
  uploaded: any[];
  skipped: any[];
  errors: any[];
  txnStatus: 'committed' | 'rolled-back' | 'partial';
  auditLogId?: string;
  timestamp: string;
}

// Default Agent Payload Template
const DEFAULT_PAYLOAD = `{
  "profileHandle": "@zara_sky",
  "adminAuth": "x-admin-token-123",
  "images": [
    {
      "sourceUrl": "https://img.coomer.st/thumbnail/data/01/3a/013ad21cee0cbc5affc55d0ed64f3aed87dcb958abcfa45ddeb51ed1004d82fd.jpg",
      "fileChecksum": "sha256:example-hash-123",
      "filename": "new_import.jpg",
      "caption": "Agent imported asset",
      "timestamp": "2026-01-01T12:00:00Z"
    }
  ],
  "dryRun": true,
  "confirm": false
}`;

export const AdminPanel = () => {
  const { profiles, addProfile, updateProfile, deleteProfile } = useMockData();
  const [view, setView] = useState<'list' | 'create' | 'edit' | 'scraper'>('list');
  const [editId, setEditId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'url_scraper' | 'batch_agent'>('url_scraper');
  
  // --- Automation AI State ---
  const [adminKey, setAdminKey] = useState('');
  const [scrapeUrl, setScrapeUrl] = useState('https://coomer.st/onlyfans/user/zara_sky/post/1972825658');
  const [batchJsonInput, setBatchJsonInput] = useState(DEFAULT_PAYLOAD);
  const [isDryRun, setIsDryRun] = useState(true);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeLogs, setScrapeLogs] = useState<LogEntry[]>([]);
  const [candidates, setCandidates] = useState<ScrapeCandidate[]>([]);
  const [importTargetProfileId, setImportTargetProfileId] = useState<string>(profiles[0]?.id || '');
  const [finalReport, setFinalReport] = useState<AutomationReport | null>(null);
  
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Form State
  const initialFormState: Profile = {
    id: '',
    name: '',
    handle: '',
    bio: '',
    category: 'Model',
    tags: [],
    avatarUrl: 'https://picsum.photos/200',
    heroUrl: 'https://picsum.photos/1200/600',
    images: [],
    stats: { posts: 0, likes: 0, views: 0, followers: 0 },
    isVerified: false,
    isVisible: true,
    pricePerMonth: 0
  };

  const [formData, setFormData] = useState<Profile>(initialFormState);
  const [tagInput, setTagInput] = useState('');
  const [isGeneratingBio, setIsGeneratingBio] = useState(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [scrapeLogs]);

  const addLog = (message: string, level: LogEntry['level'] = 'info') => {
    setScrapeLogs(prev => [...prev, {
      timestamp: new Date().toLocaleTimeString(),
      level,
      message
    }]);
  };

  const transformUrl = (url: string): string => {
    if (url.includes('img.coomer.st/data/')) {
      return url.replace('img.coomer.st/data/', 'img.coomer.st/thumbnail/data/');
    }
    return url;
  };

  // --- BATCH AGENT LOGIC ---
  const executeBatchAgent = async () => {
    setIsScraping(true);
    setScrapeLogs([]);
    setFinalReport(null);
    setCandidates([]);
    
    addLog('INITIALIZING BATCH AGENT...', 'info');

    let payload: any = null;

    try {
      // 1. Parse JSON
      try {
        payload = JSON.parse(batchJsonInput);
        addLog('PAYLOAD PARSED SUCCESSFULLY', 'success');
      } catch (e) {
        throw new Error('Invalid JSON format');
      }

      // 2. Validate Inputs
      if (!payload.profileHandle || !payload.images || !Array.isArray(payload.images)) {
        throw new Error('Missing required fields: profileHandle, images[]');
      }
      
      if (!payload.adminAuth) {
        addLog('AUTH ERROR: Missing adminAuth token', 'error');
        throw new Error('Unauthorized');
      }

      // 3. Find Profile
      const targetProfile = profiles.find(p => p.handle === payload.profileHandle);
      if (!targetProfile) {
        addLog(`PROFILE NOT FOUND: ${payload.profileHandle}`, 'error');
        throw new Error('Profile not found');
      }
      addLog(`TARGET LOCKED: ${targetProfile.handle} (${targetProfile.id})`, 'info');

      // 4. Processing Loop
      const uploaded = [];
      const skipped = [];
      const errors = [];
      const newImagesToAdd: Image[] = [];

      addLog(`PROCESSING ${payload.images.length} ITEMS...`, 'info');

      for (let i = 0; i < payload.images.length; i++) {
        const item = payload.images[i];
        const itemLogId = `[Item ${i+1}]`;
        
        try {
          // A. Validate Item
          if (!item.sourceUrl) {
            skipped.push({ ...item, reason: "Missing sourceUrl" });
            addLog(`${itemLogId} SKIPPED: Missing URL`, 'warn');
            continue;
          }

          // B. Deduplication Check (Simulated SHA256/URL Match)
          // In a real app, we would hash the file content. Here we check if the URL exists in the profile.
          const isDuplicate = targetProfile.images.some(
            existing => existing.sourceUrl === item.sourceUrl || existing.url === item.sourceUrl
          );

          if (isDuplicate) {
            skipped.push({ sourceUrl: item.sourceUrl, reason: "duplicate_skipped" });
            addLog(`${itemLogId} DUPLICATE FOUND: Skipping`, 'warn');
            continue;
          }

          // C. Prepare New Record
          const newImage: Image = {
            id: `batch-${Date.now()}-${i}`,
            url: item.sourceUrl, // In real app, this would be the new uploaded URL
            thumbnailUrl: item.sourceUrl,
            width: 1200,
            height: 1600,
            isLocked: true,
            isVisible: true,
            mediaType: 'image',
            caption: item.caption || `Uploaded by Agent ${new Date().toISOString()}`,
            sourceUrl: item.sourceUrl,
            sha256: item.fileChecksum || `simulated-hash-${Math.random()}`, // Mock hash
            createdAt: item.timestamp || new Date().toISOString()
          };

          uploaded.push({ sourceUrl: item.sourceUrl, id: newImage.id, status: "staged" });
          newImagesToAdd.push(newImage);
          addLog(`${itemLogId} STAGED FOR UPLOAD`, 'success');

        } catch (err: any) {
          errors.push({ item, error: err.message });
          addLog(`${itemLogId} ERROR: ${err.message}`, 'error');
        }
      }

      // 5. Finalize Transaction
      const isDry = payload.dryRun !== false; // Default to true if missing
      const isConfirmed = payload.confirm === true;

      let txnStatus: 'committed' | 'rolled-back' | 'partial' = 'partial';

      if (isDry) {
         addLog('DRY RUN COMPLETE: No changes committed to DB', 'warn');
         txnStatus = 'partial';
      } else {
         if (isConfirmed) {
            // COMMIT TO DB
            const updatedProfile = {
               ...targetProfile,
               images: [...targetProfile.images, ...newImagesToAdd] // Append Only
            };
            updateProfile(updatedProfile);
            txnStatus = 'committed';
            addLog(`TRANSACTION COMMITTED: ${newImagesToAdd.length} images added`, 'success');
         } else {
            addLog('ABORTED: confirm=true required for write operations', 'error');
            txnStatus = 'rolled-back';
            throw new Error('DestructiveOperationBlocked: Confirmation required');
         }
      }

      // 6. Generate Report
      const report: AutomationReport = {
        profileHandle: targetProfile.handle,
        profileId: targetProfile.id,
        operation: 'batch_upload',
        dryRun: isDry,
        attemptedCount: payload.images.length,
        uploaded,
        skipped,
        errors,
        txnStatus,
        auditLogId: `audit-${Date.now()}`,
        timestamp: new Date().toISOString()
      };
      
      setFinalReport(report);

    } catch (error: any) {
      addLog(`FATAL AGENT ERROR: ${error.message}`, 'error');
      setFinalReport({
        profileHandle: payload?.profileHandle || 'unknown',
        operation: 'batch_upload_failure',
        dryRun: true,
        uploaded: [],
        skipped: [],
        errors: [{ message: error.message }],
        txnStatus: 'rolled-back',
        timestamp: new Date().toISOString()
      });
    } finally {
      setIsScraping(false);
    }
  };

  // --- EXISTING SCRAPER LOGIC (Modified to use new generic structure) ---
  const runScraper = async () => {
    if (!adminKey) {
      addLog("MISSION FAILED: missing/invalid admin key (401)", "error");
      return;
    }
    
    setIsScraping(true);
    setScrapeLogs([]);
    setCandidates([]);
    setFinalReport(null);

    addLog(`INITIALIZING MISSION: AUTHENTICATED`, 'success');
    addLog(`TARGET PROFILE: ${profiles.find(p => p.id === importTargetProfileId)?.handle}`, 'info');

    // Simulate Network/Validation Delay
    await new Promise(r => setTimeout(r, 1000));
    addLog(`VALIDATING SOURCE URL: ${scrapeUrl}`, 'info');
    
    const mockFoundUrls = [
      "https://img.coomer.st/data/01/3a/013ad21cee0cbc5affc55d0ed64f3aed87dcb958abcfa45ddeb51ed1004d82fd.jpg",
      "https://img.coomer.st/data/02/b7/02b7f1d1c1bdb828f8dd7c6c488837d99e7ca5f40a587e1079e3e6e40c782289.jpg",
      "https://img.coomer.st/data/05/1c/051c72d624a8f88859e5f159d8e3b4333f4568d6d7e5e1aee9680aec314ea6e5.jpg",
      "https://img.coomer.st/data/14/fb/14fbf7569a4eb49ac4837b266ecadc8daed3171bb6dee6ce99e29d9ae1c0b9df.jpg"
    ];

    const newCandidates: ScrapeCandidate[] = mockFoundUrls.map((url, idx) => ({
      id: `cand-${idx}`,
      originalUrl: url,
      processedUrl: transformUrl(url),
      mediaType: 'image',
      contentType: 'image/jpeg',
      size: '1.2 MB',
      status: 'pending',
      caption: `Imported asset #${idx + 1}`
    }));

    setCandidates(newCandidates);
    addLog(`SCAN COMPLETE: FOUND ${newCandidates.length} CANDIDATES`, 'success');
    
    if (isDryRun) {
      addLog(`DRY RUN ENABLED: NO WRITE OPERATIONS EXECUTED`, 'warn');
      addLog(`REVIEW preUploadPreview BELOW`, 'info');
    }
    
    setIsScraping(false);
  };

  const executeImport = async () => {
    if (!isConfirmed && !isDryRun) {
      addLog("ABORTED: Destructive operation requested without confirm=true (409)", "error");
      return;
    }

    setIsScraping(true);
    addLog(`COMMENCING UPLOAD SEQUENCE...`, 'info');

    const targetProfile = profiles.find(p => p.id === importTargetProfileId);
    if (!targetProfile) {
      addLog('ABORTED: Profile not found (404)', 'error');
      setIsScraping(false);
      return;
    }

    const newImages: Image[] = candidates.map((cand) => ({
      id: Math.random().toString(36).substr(2, 9),
      url: cand.processedUrl,
      thumbnailUrl: cand.processedUrl,
      width: 1200,
      height: 1600,
      isLocked: false,
      isVisible: true,
      caption: cand.caption || '',
      mediaType: cand.mediaType,
      sourceUrl: cand.originalUrl, // Track source
      createdAt: new Date().toISOString()
    }));

    if (!isDryRun) {
      updateProfile({
        ...targetProfile,
        images: [...newImages, ...targetProfile.images]
      });
      addLog(`DB TRANSACTION COMMITTED`, 'success');
    }

    const report: AutomationReport = {
      profileHandle: targetProfile.handle,
      operation: 'url_scrape',
      dryRun: isDryRun,
      requestedCount: candidates.length,
      uploaded: newImages.map(img => ({ id: img.id, url: img.url })),
      skipped: [],
      errors: [],
      txnStatus: isDryRun ? 'partial' : 'committed',
      timestamp: new Date().toISOString()
    };

    setFinalReport(report);
    addLog(`REPORT GENERATED: STATUS ${report.txnStatus.toUpperCase()}`, 'success');
    setIsScraping(false);
  };

  // Standard Admin UI Logic
  const startCreate = () => { setFormData({ ...initialFormState, id: Math.random().toString(36).substr(2, 9) }); setView('create'); };
  const startEdit = (profile: Profile) => { setFormData({ ...profile }); setEditId(profile.id); setView('edit'); };
  const generateBio = async () => {
    if (!formData.name) return;
    setIsGeneratingBio(true);
    try {
      const response = await fetch('/api/generate-bio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formData.name }),
      });
      const data = await response.json();
      setFormData(prev => ({ ...prev, bio: data.bio || '' }));
    } catch (error) {
      console.error('Failed to generate bio:', error);
    } finally {
      setIsGeneratingBio(false);
    }
  };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    view === 'create' ? addProfile(formData) : updateProfile(formData);
    setView('list');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic">Control Center</h1>
          <p className="text-gray-500 font-mono text-xs">Automation Suite v2.4 // Admin Session Active</p>
        </div>
        <div className="flex gap-2">
           {view === 'list' ? (
             <>
               <button onClick={() => setView('scraper')} className="bg-purple-600 text-white px-5 py-2 rounded-full font-bold text-sm flex items-center gap-2 hover:bg-purple-700 transition-all shadow-lg shadow-purple-500/20">
                 <Terminal size={18} />
                 Automation AI
               </button>
               <button onClick={startCreate} className="bg-blue-600 text-white px-5 py-2 rounded-full font-bold text-sm flex items-center gap-2 hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20">
                 <Plus size={18} />
                 New Profile
               </button>
             </>
           ) : (
             <button onClick={() => setView('list')} className="text-gray-500 hover:text-gray-900 font-bold text-sm px-4">Exit Suite</button>
           )}
        </div>
      </div>

      {view === 'scraper' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* AI Instructions & Config */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white p-6 rounded-2xl border-2 border-slate-100 shadow-sm">
              <h2 className="text-lg font-black mb-4 flex items-center gap-2 uppercase tracking-tight">
                <Shield size={20} className="text-purple-600" />
                Mission Config
              </h2>

              {/* MODE TOGGLE */}
              <div className="flex p-1 bg-slate-100 rounded-xl mb-4">
                <button 
                  onClick={() => setActiveTab('url_scraper')} 
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${activeTab === 'url_scraper' ? 'bg-white shadow-sm text-purple-600' : 'text-gray-400'}`}
                >
                  URL Scraper
                </button>
                <button 
                  onClick={() => setActiveTab('batch_agent')} 
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${activeTab === 'batch_agent' ? 'bg-white shadow-sm text-purple-600' : 'text-gray-400'}`}
                >
                  Batch Agent
                </button>
              </div>
              
              <div className="space-y-4">
                {activeTab === 'url_scraper' ? (
                  <>
                    <div className="relative">
                      <Key size={16} className="absolute left-3 top-3 text-gray-400" />
                      <input 
                        type="password"
                        placeholder="x-admin-key"
                        className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-10 py-2.5 text-sm font-mono focus:border-purple-500 outline-none transition-all"
                        value={adminKey}
                        onChange={e => setAdminKey(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1 mb-1 block">Operation Target</label>
                      <select 
                        className="w-full bg-white border-2 border-slate-100 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-purple-500"
                        value={importTargetProfileId}
                        onChange={e => setImportTargetProfileId(e.target.value)}
                      >
                        {profiles.map(p => <option key={p.id} value={p.id}>{p.handle}</option>)}
                      </select>
                    </div>

                    <div className="flex gap-2">
                      <button 
                        onClick={() => setIsDryRun(!isDryRun)}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border-2 font-bold text-xs transition-all ${isDryRun ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-white border-slate-100 text-slate-400'}`}
                      >
                        <FileSearch size={14} />
                        Dry Run
                      </button>
                      <button 
                        onClick={() => setIsConfirmed(!isConfirmed)}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border-2 font-bold text-xs transition-all ${isConfirmed ? 'bg-green-50 border-green-200 text-green-600' : 'bg-white border-slate-100 text-slate-400'}`}
                      >
                        <CheckCircle size={14} />
                        Confirm
                      </button>
                    </div>

                    <button 
                      onClick={runScraper}
                      disabled={isScraping}
                      className="w-full bg-slate-900 text-white py-3 rounded-xl font-black uppercase tracking-tighter hover:bg-slate-800 transition-all flex justify-center items-center gap-2 disabled:opacity-50"
                    >
                      {isScraping ? <Loader className="animate-spin" size={20} /> : <PlayCircle size={20} />}
                      Execute Scrape
                    </button>
                  </>
                ) : (
                  <>
                     <div className="relative">
                       <div className="absolute top-2 left-2 right-2 flex justify-between items-center pointer-events-none">
                         <span className="text-[10px] font-bold text-gray-400 uppercase bg-slate-50 px-2 rounded">JSON Payload Input</span>
                       </div>
                       <textarea 
                         className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-8 text-[10px] font-mono focus:border-purple-500 outline-none transition-all h-[240px] resize-none"
                         value={batchJsonInput}
                         onChange={e => setBatchJsonInput(e.target.value)}
                         spellCheck={false}
                       />
                     </div>
                     <button 
                        onClick={executeBatchAgent}
                        disabled={isScraping}
                        className="w-full bg-purple-600 text-white py-3 rounded-xl font-black uppercase tracking-tighter hover:bg-purple-700 transition-all flex justify-center items-center gap-2 disabled:opacity-50 shadow-lg shadow-purple-500/20"
                      >
                        {isScraping ? <Loader className="animate-spin" size={20} /> : <Code size={20} />}
                        Run Batch Agent
                      </button>
                  </>
                )}
              </div>
            </div>

            {/* Terminal Logs */}
            <div className="bg-[#0f0f0f] p-5 rounded-2xl shadow-2xl h-[350px] flex flex-col font-mono text-[11px] border border-slate-800">
              <div className="flex justify-between items-center text-slate-500 mb-3 border-b border-slate-800 pb-2">
                <span className="flex items-center gap-2"><Fingerprint size={12}/> SYSTEM LOGS</span>
                <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded">UTC-0</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 pr-2 no-scrollbar">
                {scrapeLogs.map((log, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-slate-600">[{log.timestamp}]</span>
                    <span className={`
                      ${log.level === 'info' ? 'text-slate-400' : ''}
                      ${log.level === 'warn' ? 'text-amber-500' : ''}
                      ${log.level === 'error' ? 'text-rose-500 font-bold' : ''}
                      ${log.level === 'success' ? 'text-emerald-400' : ''}
                    `}>{log.message}</span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>

          {/* Scrape Results & Report */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            
            {/* Visualizer (Only for URL Scraper Mode) */}
            {activeTab === 'url_scraper' && (
              <div className="bg-white rounded-2xl border shadow-sm flex-1 flex flex-col overflow-hidden h-[500px]">
                <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
                  <h3 className="font-black text-slate-700 uppercase tracking-tighter">Pre-Upload Preview ({candidates.length})</h3>
                  {candidates.length > 0 && (
                    <button 
                      onClick={executeImport}
                      disabled={isScraping}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-full text-xs font-black uppercase tracking-tighter transition-all"
                    >
                      Commit Operation
                    </button>
                  )}
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 bg-slate-100/50 grid grid-cols-2 md:grid-cols-4 gap-3">
                   {candidates.map(cand => (
                     <div key={cand.id} className="bg-white rounded-xl border-2 border-white shadow-sm overflow-hidden group relative">
                        <img src={cand.processedUrl} className="w-full aspect-square object-cover" alt="Candidate profile image" />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-2 text-center">
                           <span className="text-[10px] text-white font-bold">{cand.size}</span>
                           <span className="text-[8px] text-emerald-400 truncate w-full">{cand.processedUrl}</span>
                        </div>
                     </div>
                   ))}
                   {candidates.length === 0 && (
                     <div className="col-span-full h-full flex flex-col items-center justify-center text-slate-300 py-20">
                       <FileSearch size={64} className="mb-4 opacity-10" />
                       <p className="font-bold uppercase tracking-widest text-xs">Waiting for sequence initiation</p>
                     </div>
                   )}
                </div>
              </div>
            )}

            {/* JSON Report View (Always visible if report exists, takes full height for Batch Mode) */}
            {(finalReport || activeTab === 'batch_agent') && (
              <div className={`bg-slate-900 rounded-2xl p-6 border border-slate-800 animate-in fade-in slide-in-from-bottom-4 duration-500 ${activeTab === 'batch_agent' ? 'h-full flex flex-col' : ''}`}>
                <div className="flex items-center gap-3 mb-4 shrink-0">
                   <div className="w-10 h-10 bg-emerald-500/10 rounded-full flex items-center justify-center text-emerald-500">
                     <CheckCircle size={24} />
                   </div>
                   <div>
                     <h3 className="text-white font-bold uppercase tracking-tighter">Transaction Report</h3>
                     <p className="text-slate-400 text-xs font-mono">Status: {finalReport?.txnStatus || 'WAITING...'}</p>
                   </div>
                </div>
                <div className="flex-1 relative overflow-hidden bg-black/40 rounded-xl border border-white/5">
                   {finalReport ? (
                      <pre className="absolute inset-0 p-4 text-[10px] text-emerald-400 font-mono overflow-auto">
                        {JSON.stringify(finalReport, null, 2)}
                      </pre>
                   ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-slate-700">
                        <p className="font-mono text-xs">NO REPORT GENERATED</p>
                      </div>
                   )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {view === 'list' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {profiles.map(p => (
             <div key={p.id} className="bg-white p-6 rounded-2xl border shadow-sm flex flex-col">
                <div className="flex items-center gap-4 mb-4">
                   <img src={p.avatarUrl} className="w-16 h-16 rounded-2xl object-cover bg-slate-100" alt="Profile avatar" />
                   <div>
                      <h3 className="font-black text-slate-900 text-xl tracking-tighter">{p.name}</h3>
                      <p className="text-gray-500 font-mono text-xs">{p.handle}</p>
                   </div>
                </div>
                <div className="flex gap-2 mt-auto">
                   <button onClick={() => startEdit(p)} className="flex-1 bg-slate-50 text-slate-600 py-2 rounded-xl font-bold text-xs hover:bg-slate-100 transition-all flex items-center justify-center gap-2">
                     <Edit2 size={14}/> Edit
                   </button>
                   <button 
                     onClick={() => { if(confirm('IRREVERSIBLE: Confirm deletion?')) deleteProfile(p.id); }}
                     className="bg-rose-50 text-rose-600 px-4 py-2 rounded-xl font-bold text-xs hover:bg-rose-100 transition-all"
                   >
                     <Trash2 size={14}/>
                   </button>
                </div>
             </div>
           ))}
        </div>
      )}

      {(view === 'create' || view === 'edit') && (
        <div className="bg-white rounded-3xl border shadow-2xl p-10 max-w-4xl mx-auto border-t-8 border-t-slate-900">
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
               <div className="space-y-4">
                  <h3 className="font-black uppercase tracking-widest text-[10px] text-slate-400">Core Identity</h3>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 ml-1">Display Name</label>
                    <input required className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-2.5 outline-none focus:border-slate-900 transition-all" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 ml-1">Handle</label>
                    <input required className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-2.5 outline-none focus:border-slate-900 transition-all" value={formData.handle} onChange={e => setFormData({...formData, handle: e.target.value})} />
                  </div>
               </div>
               <div className="space-y-4">
                  <h3 className="font-black uppercase tracking-widest text-[10px] text-slate-400">Assets</h3>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 ml-1">Avatar URL</label>
                    <input className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-2.5 outline-none focus:border-slate-900 transition-all" value={formData.avatarUrl} onChange={e => setFormData({...formData, avatarUrl: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 ml-1">Hero URL</label>
                    <input className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-2.5 outline-none focus:border-slate-900 transition-all" value={formData.heroUrl} onChange={e => setFormData({...formData, heroUrl: e.target.value})} />
                  </div>
               </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-black uppercase tracking-widest text-[10px] text-slate-400">Biography</h3>
                <button type="button" onClick={generateBio} disabled={isGeneratingBio} className="flex items-center gap-2 text-xs font-black text-blue-600 uppercase tracking-tight bg-blue-50 px-3 py-1.5 rounded-full hover:bg-blue-100">
                   {isGeneratingBio ? <Loader size={12} className="animate-spin"/> : <Sparkles size={12}/>}
                   AI Compose
                </button>
              </div>
              <textarea className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-4 py-3 h-32 outline-none focus:border-slate-900 transition-all" value={formData.bio} onChange={e => setFormData({...formData, bio: e.target.value})} />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t-2 border-slate-50">
               <button type="button" onClick={() => setView('list')} className="px-8 py-3 rounded-full font-bold text-slate-400 hover:text-slate-900 transition-all">Cancel</button>
               <button type="submit" className="px-10 py-3 bg-slate-900 text-white rounded-full font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/20">
                 Finalize Profile
               </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};