import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Download, Edit2, Eye, EyeOff,
  FileJson, Image as ImageIcon, KeyRound, LayoutDashboard, Loader2, Lock, LogOut,
  Megaphone, Play, Plus, RefreshCw, Save, Search, ShieldCheck, Sparkles, Trash2,
  Upload, Users, Video, Wand2, X,
} from 'lucide-react';
import { useMockData } from '../services/mockData';
import {
  AdminProfileEntry, applyProfileRecord, buildCmsProfileRecord, CmsApiError,
  deleteAdvert as deleteAdvertApi, downloadJson, emptyAdvert, emptyProfile,
  exportAdminCms, getAdminContent, getAdminSession, loginAdmin, logoutAdmin,
  makeMediaId, mergeAdminProfiles, normalizeTags, permanentlyDeleteCmsProfileRecord,
  saveAdvert as saveAdvertApi, saveCmsProfileRecord, scrapeProfileUrl, slugifyProfileId,
  type AdminSession, type ScrapeResult,
} from '../services/cms';
import type {
  AdminCmsContent, Advert, AdvertKind, AdvertPlacement, AdvertStatus,
  CmsProfileOrigin, CmsProfileStatus, Image, Profile,
} from '../types';

type AdminTab = 'dashboard' | 'profiles' | 'scraper' | 'adverts' | 'setup';
type Notice = { tone: 'success' | 'error' | 'info'; message: string } | null;

interface ProfileEditState {
  profile: Profile;
  original?: Profile;
  origin: CmsProfileOrigin;
  status: CmsProfileStatus;
  isNew: boolean;
}

const inputCls = 'w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-600 focus:border-red-500 focus:ring-2 focus:ring-red-500/20';
const labelCls = 'mb-1.5 block text-[11px] font-black uppercase tracking-[0.16em] text-gray-500';
const panelCls = 'rounded-3xl border border-white/10 bg-[#101014] shadow-2xl shadow-black/30';
const buttonCls = 'inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50';
const RESERVED_IDS = new Set(['admin', 'auth', 'favorites', 'search', 'hashtags', 'more', 'api', 'profile', 'sitemap', 'robots', 'assets', 'favicon', 'index']);

const profileStatusLabels: Record<CmsProfileStatus, string> = {
  published: 'Published', draft: 'Draft', hidden: 'Hidden', deleted: 'Deleted',
};
const profileStatusStyles: Record<CmsProfileStatus, string> = {
  published: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  draft: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  hidden: 'border-slate-400/30 bg-slate-400/10 text-slate-300',
  deleted: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
};
const advertKindLabels: Record<AdvertKind, string> = {
  managed: 'Managed banner', script: 'Script slot', html: 'HTML slot',
  popunder: 'Popunder', social_bar: 'Social bar', native_banner: 'Native banner',
};
const advertPlacementLabels: Record<AdvertPlacement, string> = {
  global: 'Global (scripts only)', sidebar: 'Sidebar', home_top: 'Home — top',
  home_inline: 'Home — inside profile list', home_bottom: 'Home — bottom',
  profile_top: 'Profile — top', profile_inline: 'Profile — after media grid',
  profile_bottom: 'Profile — bottom',
};

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function errorText(error: unknown): string { return error instanceof Error ? error.message : 'Something went wrong.'; }
function isAssetUrl(value: string): boolean {
  const cleaned = value.trim();
  if (!cleaned) return false;
  if (cleaned.startsWith('/')) {
    try { return new URL(cleaned, window.location.origin).origin === window.location.origin; } catch { return false; }
  }
  try { const url = new URL(cleaned); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; }
}
function numberText(value: number): string { return new Intl.NumberFormat().format(value || 0); }
function toDateTimeLocal(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs leading-relaxed text-gray-600">{hint}</span>}
    </label>
  );
}

function MediaPreview({ media, className = 'aspect-[4/5]' }: { media: Image; className?: string }) {
  const thumbnailIsVideo = /\.(mp4|webm|mov|m4v|ogv)(?:\?|$)/i.test(media.thumbnailUrl || '');
  if (media.mediaType === 'video') {
    return (
      <div className={`relative overflow-hidden bg-black ${className}`}>
        {media.thumbnailUrl && !thumbnailIsVideo
          ? <img src={media.thumbnailUrl} alt={media.caption || 'Video preview'} className="h-full w-full object-cover" loading="lazy" />
          : <video src={media.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />}
        <span className="absolute inset-0 flex items-center justify-center bg-black/25"><span className="rounded-full bg-black/60 p-3 text-white"><Play size={20} fill="currentColor" /></span></span>
      </div>
    );
  }
  return <img src={media.thumbnailUrl || media.url} alt={media.caption || 'Profile media'} loading="lazy" className={`w-full bg-black object-cover ${className}`} />;
}

function StatCard({ label, value, detail, icon }: { label: string; value: string | number; detail: string; icon: React.ReactNode }) {
  return (
    <div className={`${panelCls} p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-500">{label}</p><p className="mt-2 text-3xl font-black text-white">{value}</p><p className="mt-1 text-xs text-gray-500">{detail}</p></div>
        <div className="rounded-2xl bg-red-500/10 p-3 text-red-400">{icon}</div>
      </div>
    </div>
  );
}

export const AdminPanel = () => {
  const { baseProfiles, refreshCmsContent } = useMockData();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [session, setSession] = useState<AdminSession | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [content, setContent] = useState<AdminCmsContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [notice, setNotice] = useState<Notice>(null);

  const [profileQuery, setProfileQuery] = useState('');
  const [profileStatusFilter, setProfileStatusFilter] = useState<'all' | CmsProfileStatus>('all');
  const [profileOriginFilter, setProfileOriginFilter] = useState<'all' | CmsProfileOrigin>('all');
  const [editingProfile, setEditingProfile] = useState<ProfileEditState | null>(null);
  const [tagText, setTagText] = useState('');
  const [profileBusy, setProfileBusy] = useState('');
  const [pendingProfileDelete, setPendingProfileDelete] = useState<AdminProfileEntry | null>(null);
  const [pendingProfileReset, setPendingProfileReset] = useState<AdminProfileEntry | null>(null);
  const [mediaQuery, setMediaQuery] = useState('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'all' | 'image' | 'video'>('all');
  const [mediaVisibleCount, setMediaVisibleCount] = useState(48);
  const [newMediaUrl, setNewMediaUrl] = useState('');
  const [bulkMediaText, setBulkMediaText] = useState('');

  const [scrapeUrl, setScrapeUrl] = useState('');
  const [extraScrapeUrls, setExtraScrapeUrls] = useState('');
  const [scrapeMaxItems, setScrapeMaxItems] = useState(300);
  const [scrapeMaxPages, setScrapeMaxPages] = useState(3);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null);
  const [selectedScrapeMediaIds, setSelectedScrapeMediaIds] = useState<string[]>([]);
  const [appendTargetProfileId, setAppendTargetProfileId] = useState('');
  const [importJsonText, setImportJsonText] = useState('');

  const [editingAdvert, setEditingAdvert] = useState<Advert | null>(null);
  const [advertQuery, setAdvertQuery] = useState('');
  const [advertStatusFilter, setAdvertStatusFilter] = useState<'all' | AdvertStatus>('all');
  const [advertBusy, setAdvertBusy] = useState('');
  const [pendingAdvertDelete, setPendingAdvertDelete] = useState<Advert | null>(null);

  const profileEntries = useMemo(
    () => content ? mergeAdminProfiles(baseProfiles, content.profileRecords) : [],
    [baseProfiles, content],
  );
  const publicProfileCount = profileEntries.filter(entry => entry.status === 'published' && entry.profile.isVisible !== false).length;
  const totalMediaCount = profileEntries.reduce((sum, entry) => sum + entry.profile.images.length, 0);
  const activeAdvertCount = (content?.adverts || []).filter(advert => advert.status === 'active').length;

  const loadContent = useCallback(async () => {
    setContentLoading(true);
    try {
      const data = await getAdminContent();
      setContent(data);
      setScrapeMaxItems(current => Math.min(current, data.config.scraperMaxItems));
      setScrapeMaxPages(current => Math.min(current, data.config.scraperMaxPages));
      await refreshCmsContent();
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setContentLoading(false);
    }
  }, [refreshCmsContent]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const current = await getAdminSession();
        if (!active) return;
        setSession(current);
        if (current.authenticated) await loadContent();
      } catch (error) {
        if (active) setSessionError(errorText(error));
      } finally {
        if (active) setSessionChecked(true);
      }
    })();
    return () => { active = false; };
  }, [loadContent]);

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginBusy(true);
    setNotice(null);
    try {
      const current = await loginAdmin(usernameInput.trim(), passwordInput);
      setSession(current);
      setPasswordInput('');
      await loadContent();
      setNotice({ tone: 'success', message: 'Website admin session started.' });
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setLoginBusy(false);
    }
  };

  const submitLogout = async () => {
    try { await logoutAdmin(); } catch { /* clear the local UI even if the session already expired */ }
    setSession({ authenticated: false, config: session?.config });
    setContent(null);
    setEditingProfile(null);
    setEditingAdvert(null);
  };

  const replaceProfileRecord = (record: AdminCmsContent['profileRecords'][number]) => {
    setContent(current => current ? { ...current, profileRecords: [record, ...current.profileRecords.filter(item => item.id !== record.id)] } : current);
  };
  const replaceAdvert = (advert: Advert) => {
    setContent(current => current ? { ...current, adverts: [advert, ...current.adverts.filter(item => item.id !== advert.id)] } : current);
  };

  const openProfileEditor = (state: ProfileEditState) => {
    setEditingProfile({ ...state, profile: clone(state.profile), original: state.original ? clone(state.original) : undefined });
    setTagText(state.profile.tags.join(', '));
    setMediaQuery('');
    setMediaTypeFilter('all');
    setMediaVisibleCount(48);
    setNewMediaUrl('');
    setBulkMediaText('');
    setActiveTab('profiles');
  };

  const startCreateProfile = (profile: Profile = emptyProfile()) => {
    openProfileEditor({ profile, origin: 'cms', status: 'draft', isNew: true });
  };

  const updateEditingProfile = (updater: (profile: Profile) => Profile) => {
    setEditingProfile(current => current ? { ...current, profile: updater(clone(current.profile)) } : current);
  };

  const validateEditingProfile = (status: CmsProfileStatus): string[] => {
    if (!editingProfile) return ['No profile is open.'];
    const profile = editingProfile.profile;
    const id = slugifyProfileId(profile.id);
    const errors: string[] = [];
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id) || RESERVED_IDS.has(id)) errors.push('Profile ID must be a valid 2–64 character slug and cannot be a reserved route.');
    if (editingProfile.isNew && profileEntries.some(entry => entry.profile.id === id)) errors.push('That profile ID already exists. Edit the existing profile or append scraped media to it.');
    if (!editingProfile.isNew && editingProfile.profile.id !== (editingProfile.original?.id || editingProfile.profile.id) && editingProfile.origin === 'builtin') errors.push('Built-in profile IDs cannot be renamed in D1 because the bundled media file uses the original ID.');
    if (status === 'published') {
      if (!profile.name.trim()) errors.push('Published profiles need a display name.');
      if (profile.bio.trim().length < 10) errors.push('Published profiles need a bio of at least 10 characters.');
      if (!isAssetUrl(profile.avatarUrl) || !isAssetUrl(profile.heroUrl)) errors.push('Published profiles need avatar and hero URLs (public http(s) or same-origin /path).');
      if (!profile.images.length) errors.push('Published profiles need at least one image or video.');
    }
    if (profile.images.some(media => !isAssetUrl(media.url) || !isAssetUrl(media.thumbnailUrl))) errors.push('Every saved media item needs a public http(s) URL or same-origin /path for its media and thumbnail.');
    if (new Set(profile.images.map(media => media.id)).size !== profile.images.length) errors.push('Media IDs must be unique inside the profile.');
    return errors;
  };

  const saveEditingProfile = async (status = editingProfile?.status || 'draft') => {
    if (!editingProfile) return;
    const errors = validateEditingProfile(status);
    if (errors.length) { setNotice({ tone: 'error', message: errors.join(' ') }); return; }
    const edited = clone(editingProfile.profile);
    edited.id = slugifyProfileId(edited.id);
    edited.handle = edited.handle.trim().startsWith('@') ? edited.handle.trim() : `@${edited.handle.trim() || edited.id}`;
    edited.tags = normalizeTags(tagText);
    if (!edited.heroUrl && edited.avatarUrl) edited.heroUrl = edited.avatarUrl;

    setProfileBusy('save');
    try {
      const record = buildCmsProfileRecord({
        original: editingProfile.original,
        edited,
        status,
        origin: editingProfile.origin,
      });
      const saved = await saveCmsProfileRecord(record);
      replaceProfileRecord(saved.record);
      await refreshCmsContent();
      const applied = applyProfileRecord(editingProfile.original, saved.record) || edited;
      setEditingProfile({ ...editingProfile, profile: applied, status: saved.record.status, isNew: false });
      setTagText(applied.tags.join(', '));
      setNotice({ tone: 'success', message: status === 'published' ? 'Profile published to the website CMS.' : `Profile saved as ${profileStatusLabels[status].toLowerCase()}.` });
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setProfileBusy('');
    }
  };

  const saveEntryStatus = async (entry: AdminProfileEntry, status: CmsProfileStatus) => {
    setProfileBusy(entry.profile.id);
    try {
      const record = buildCmsProfileRecord({ original: entry.original, edited: entry.profile, status, origin: entry.origin });
      const saved = await saveCmsProfileRecord(record);
      replaceProfileRecord(saved.record);
      await refreshCmsContent();
      setNotice({ tone: 'success', message: `${entry.profile.name} is now ${profileStatusLabels[status].toLowerCase()}.` });
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setProfileBusy('');
      setPendingProfileDelete(null);
    }
  };

  const resetProfileRecord = async (entry: AdminProfileEntry) => {
    if (!entry.record) return;
    setProfileBusy(entry.profile.id);
    try {
      await permanentlyDeleteCmsProfileRecord(entry.profile.id);
      setContent(current => current ? { ...current, profileRecords: current.profileRecords.filter(record => record.id !== entry.profile.id) } : current);
      await refreshCmsContent();
      setNotice({ tone: 'success', message: entry.origin === 'builtin' ? 'D1 overlay removed; the bundled built-in profile is public again.' : 'CMS profile permanently deleted from D1.' });
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setProfileBusy('');
      setPendingProfileReset(null);
    }
  };

  const addMediaUrls = (urls: string[]) => {
    if (!editingProfile) return;
    const cleaned = [...new Set(urls.map(url => url.trim()).filter(Boolean))];
    if (!cleaned.length) return;
    updateEditingProfile(profile => {
      const existingUrls = new Set(profile.images.map(media => media.url));
      const additions: Image[] = [];
      for (const raw of cleaned) {
        if (!isAssetUrl(raw)) continue;
        const isVideo = /\.(mp4|webm|mov|m4v|ogv)(?:\?|$)/i.test(raw);
        const displayUrl = !isVideo && raw.includes('img.coomer.st/data/') ? raw.replace('img.coomer.st/data/', 'img.coomer.st/thumbnail/data/') : raw;
        if (existingUrls.has(displayUrl)) continue;
        additions.push({
          id: makeMediaId(profile.id || 'profile', [...profile.images, ...additions]),
          url: displayUrl,
          thumbnailUrl: displayUrl,
          caption: isVideo ? 'Video preview ▶️' : 'Creator preview ✨',
          width: isVideo ? 1080 : 800,
          height: isVideo ? 1350 : 1000,
          isLocked: true,
          isVisible: true,
          mediaType: isVideo ? 'video' : 'image',
          sourceUrl: raw,
          createdAt: new Date().toISOString(),
        });
      }
      profile.images = [...additions, ...profile.images];
      profile.stats = { ...profile.stats, posts: profile.images.length };
      return profile;
    });
    setNewMediaUrl('');
    setBulkMediaText('');
  };

  const updateMedia = (mediaId: string, patch: Partial<Image>) => {
    updateEditingProfile(profile => {
      profile.images = profile.images.map(media => media.id === mediaId ? { ...media, ...patch } : media);
      return profile;
    });
  };

  const moveMedia = (mediaId: string, direction: -1 | 1) => {
    updateEditingProfile(profile => {
      const index = profile.images.findIndex(media => media.id === mediaId);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= profile.images.length) return profile;
      [profile.images[index], profile.images[next]] = [profile.images[next], profile.images[index]];
      return profile;
    });
  };

  const filteredProfiles = profileEntries.filter(entry => {
    if (profileStatusFilter !== 'all' && entry.status !== profileStatusFilter) return false;
    if (profileOriginFilter !== 'all' && entry.origin !== profileOriginFilter) return false;
    const query = profileQuery.trim().toLowerCase();
    if (!query) return true;
    return [entry.profile.id, entry.profile.name, entry.profile.handle, entry.profile.category, ...entry.profile.tags].join(' ').toLowerCase().includes(query);
  });

  const runScrape = async () => {
    if (!rightsConfirmed) {
      setNotice({ tone: 'error', message: 'Confirm that you own the content or have permission to publish it before scraping.' });
      return;
    }
    const urls = extraScrapeUrls.split(/[\n,]+/).map(item => item.trim()).filter(Boolean);
    setScraping(true);
    setNotice(null);
    try {
      const result = await scrapeProfileUrl({
        url: scrapeUrl.trim(),
        urls,
        maxItems: scrapeMaxItems,
        maxPages: scrapeMaxPages,
        rightsConfirmed,
      });
      setScrapeResult(result);
      setSelectedScrapeMediaIds(result.draftProfile.images.map(media => media.id));
      setAppendTargetProfileId(
        profileEntries.some(entry => entry.profile.id === result.draftProfile.id)
          ? result.draftProfile.id
          : '',
      );
      setNotice({ tone: 'success', message: `Scrape complete: found ${result.draftProfile.images.length} media items. Review everything before publishing.` });
    } catch (error) {
      setScrapeResult(null);
      setSelectedScrapeMediaIds([]);
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setScraping(false);
    }
  };

  const selectedScrapeProfile = (): Profile | null => {
    if (!scrapeResult) return null;
    const profile = clone(scrapeResult.draftProfile);
    profile.images = profile.images.filter(media => selectedScrapeMediaIds.includes(media.id));
    profile.stats = { ...profile.stats, posts: profile.images.length };
    return profile;
  };

  const createDraftFromScrape = () => {
    const profile = selectedScrapeProfile();
    if (!profile?.images.length) { setNotice({ tone: 'error', message: 'Select at least one scraped media item first.' }); return; }
    startCreateProfile(profile);
    setNotice({ tone: 'info', message: 'Scraped profile opened as a draft. Review the name, bio, avatar, hero, tags, captions, and rights before publishing.' });
  };

  const appendScrapeToExisting = () => {
    const scraped = selectedScrapeProfile();
    const entry = profileEntries.find(item => item.profile.id === appendTargetProfileId);
    if (!scraped?.images.length || !entry) { setNotice({ tone: 'error', message: 'Choose an existing profile and select at least one scraped media item.' }); return; }
    const profile = clone(entry.profile);
    const existingKeys = new Set(profile.images.flatMap(media => [media.url, media.thumbnailUrl, media.sourceUrl].filter(Boolean) as string[]));
    const additions: Image[] = [];
    for (const media of scraped.images) {
      const keys = [media.url, media.thumbnailUrl, media.sourceUrl].filter(Boolean) as string[];
      if (keys.some(key => existingKeys.has(key))) continue;
      keys.forEach(key => existingKeys.add(key));
      additions.push({ ...media, id: makeMediaId(profile.id, [...profile.images, ...additions]) });
    }
    // Keep the source order when placing the newly imported block first.
    profile.images = [...additions, ...profile.images];
    profile.stats = { ...profile.stats, posts: profile.images.length };
    openProfileEditor({ profile, original: entry.original, origin: entry.origin, status: entry.status, isNew: false });
    setNotice({ tone: 'info', message: `${additions.length} scraped item(s) staged on ${entry.profile.name}. Review and save to publish the change.` });
  };

  const importProfileJson = () => {
    try {
      const parsed = JSON.parse(importJsonText) as Record<string, unknown>;
      if (typeof parsed.id === 'string' && Array.isArray(parsed.images)) {
        const base = emptyProfile();
        startCreateProfile({ ...base, ...(parsed as unknown as Profile), stats: { ...base.stats, ...((parsed.stats as Profile['stats']) || {}) } });
        setNotice({ tone: 'info', message: 'Profile JSON opened as a draft. Review and save it to D1.' });
        return;
      }
      if (Array.isArray(parsed.images) && typeof parsed.profileHandle === 'string') {
        const entry = profileEntries.find(item => item.profile.handle === parsed.profileHandle || item.profile.id === slugifyProfileId(parsed.profileHandle as string));
        if (!entry) throw new Error('The profileHandle in that JSON does not match an existing profile.');
        const profile = clone(entry.profile);
        const existingKeys = new Set(profile.images.flatMap(media => [media.url, media.thumbnailUrl, media.sourceUrl].filter(Boolean) as string[]));
        const additions: Image[] = [];
        for (const raw of parsed.images as Array<Record<string, unknown>>) {
          const sourceUrl = String(raw.sourceUrl || raw.url || raw.thumbnailUrl || '');
          const isVideo = raw.mediaType === 'video' || /\.(mp4|webm|mov|m4v|ogv)(?:\?|$)/i.test(sourceUrl);
          const suppliedDisplayUrl = String(raw.url || raw.thumbnailUrl || sourceUrl);
          const displayUrl = !isVideo && suppliedDisplayUrl.includes('img.coomer.st/data/')
            ? suppliedDisplayUrl.replace('img.coomer.st/data/', 'img.coomer.st/thumbnail/data/')
            : suppliedDisplayUrl;
          const thumbnailUrl = isAssetUrl(String(raw.thumbnailUrl || '')) ? String(raw.thumbnailUrl) : displayUrl;
          const keys = [displayUrl, thumbnailUrl, sourceUrl].filter(Boolean);
          if (!isAssetUrl(displayUrl) || keys.some(key => existingKeys.has(key))) continue;
          keys.forEach(key => existingKeys.add(key));
          additions.push({
            id: makeMediaId(profile.id, [...profile.images, ...additions]),
            url: displayUrl,
            thumbnailUrl,
            caption: String(raw.caption || ''),
            width: Number(raw.width) || (isVideo ? 1080 : 800),
            height: Number(raw.height) || (isVideo ? 1350 : 1000),
            isLocked: raw.isLocked !== false,
            isVisible: raw.isVisible !== false,
            mediaType: isVideo ? 'video' : 'image',
            sourceUrl,
            createdAt: String(raw.timestamp || raw.createdAt || new Date().toISOString()),
          });
        }
        // Keep the source order when placing the newly imported block first.
        profile.images = [...additions, ...profile.images];
        profile.stats = { ...profile.stats, posts: profile.images.length };
        openProfileEditor({ profile, original: entry.original, origin: entry.origin, status: entry.status, isNew: false });
        setNotice({ tone: 'info', message: `${additions.length} batch media item(s) staged in the profile editor. Review and save to commit.` });
        return;
      }
      throw new Error('Paste either a complete website Profile JSON or a batch object with profileHandle and images[].');
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    }
  };

  const saveEditingAdvert = async () => {
    if (!editingAdvert) return;
    const advert = clone(editingAdvert);
    advert.id = slugifyProfileId(advert.id);
    if (!advert.title.trim()) { setNotice({ tone: 'error', message: 'Give the advert an internal title.' }); return; }
    if ((advert.kind === 'popunder' || advert.kind === 'social_bar') && advert.placement !== 'global') advert.placement = 'global';
    if (advert.kind === 'managed' && advert.placement === 'global') advert.placement = 'home_top';
    if (advert.kind === 'native_banner' && advert.placement === 'global') advert.placement = 'home_inline';
    setAdvertBusy('save');
    try {
      const saved = await saveAdvertApi(advert);
      replaceAdvert(saved.advert);
      setEditingAdvert(saved.advert);
      await refreshCmsContent();
      setNotice({ tone: 'success', message: `Advert “${saved.advert.title}” saved.` });
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setAdvertBusy('');
    }
  };

  const setAdvertStatus = async (advert: Advert, status: AdvertStatus) => {
    setAdvertBusy(advert.id);
    try {
      const saved = await saveAdvertApi({ ...advert, status });
      replaceAdvert(saved.advert);
      await refreshCmsContent();
      setNotice({ tone: 'success', message: `${advert.title} is now ${status}.` });
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setAdvertBusy('');
    }
  };

  const removeAdvert = async (advert: Advert) => {
    setAdvertBusy(advert.id);
    try {
      await deleteAdvertApi(advert.id);
      setContent(current => current ? { ...current, adverts: current.adverts.filter(item => item.id !== advert.id) } : current);
      if (editingAdvert?.id === advert.id) setEditingAdvert(null);
      await refreshCmsContent();
      setNotice({ tone: 'success', message: `Advert “${advert.title}” deleted.` });
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setAdvertBusy('');
      setPendingAdvertDelete(null);
    }
  };

  const filteredAdverts = (content?.adverts || []).filter(advert => {
    if (advertStatusFilter !== 'all' && advert.status !== advertStatusFilter) return false;
    const query = advertQuery.trim().toLowerCase();
    if (!query) return true;
    return [advert.id, advert.title, advert.kind, advert.placement, advert.headline || ''].join(' ').toLowerCase().includes(query);
  }).sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));

  const downloadBackup = async () => {
    try {
      const backup = await exportAdminCms();
      downloadJson(`fansleak-website-cms-${new Date().toISOString().slice(0, 10)}.json`, backup);
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    }
  };

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Public profiles" value={publicProfileCount} detail={`${profileEntries.length} total incl. drafts and hidden`} icon={<Users size={22} />} />
        <StatCard label="Profile media" value={numberText(totalMediaCount)} detail="Across built-in and D1 profiles" icon={<ImageIcon size={22} />} />
        <StatCard label="Active adverts" value={activeAdvertCount} detail={`${content?.adverts.length || 0} total advert records`} icon={<Megaphone size={22} />} />
        <StatCard label="CMS records" value={content?.profileRecords.length || 0} detail="Overlays and D1-created profiles" icon={<ShieldCheck size={22} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <button onClick={() => startCreateProfile()} className={`${panelCls} p-6 text-left transition hover:border-red-500/50`}>
          <Plus className="text-red-400" size={26} /><h3 className="mt-4 text-lg font-black text-white">New profile</h3><p className="mt-1 text-sm text-gray-500">Create a profile using the normal FansLeak fields, media, tags and stats.</p>
        </button>
        <button onClick={() => setActiveTab('scraper')} className={`${panelCls} p-6 text-left transition hover:border-red-500/50`}>
          <Wand2 className="text-red-400" size={26} /><h3 className="mt-4 text-lg font-black text-white">Scrape a URL</h3><p className="mt-1 text-sm text-gray-500">Import authorized Coomer, webpage, or direct media URLs into a reviewable draft.</p>
        </button>
        <button onClick={() => { setEditingAdvert(emptyAdvert()); setActiveTab('adverts'); }} className={`${panelCls} p-6 text-left transition hover:border-red-500/50`}>
          <Megaphone className="text-red-400" size={26} /><h3 className="mt-4 text-lg font-black text-white">New advert</h3><p className="mt-1 text-sm text-gray-500">Add managed banners, native slots, social bars, scripts, HTML, or popunders.</p>
        </button>
      </div>

      <div className={`${panelCls} p-6`}>
        <h3 className="text-lg font-black text-white">Latest CMS activity</h3>
        {content?.profileRecords.length ? (
          <div className="mt-4 divide-y divide-white/5">
            {content.profileRecords.slice(0, 8).map(record => (
              <div key={record.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <span className="font-bold text-gray-200">{record.profile?.name || record.patch?.name || record.id}</span>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${profileStatusStyles[record.status]}`}>{record.status}</span>
                <span className="text-xs text-gray-600">{record.updatedAt ? new Date(record.updatedAt).toLocaleString() : 'No timestamp'}</span>
              </div>
            ))}
          </div>
        ) : <p className="mt-3 text-sm text-gray-500">No D1 profile changes yet. Built-in profiles remain bundled in code until you edit them here.</p>}
      </div>
    </div>
  );

  const renderProfileEditor = () => {
    if (!editingProfile) return null;
    const profile = editingProfile.profile;
    const filteredMedia = profile.images
      .map((media, index) => ({ media, index }))
      .filter(({ media }) => {
        if (mediaTypeFilter !== 'all' && media.mediaType !== mediaTypeFilter) return false;
        const query = mediaQuery.trim().toLowerCase();
        return !query || [media.id, media.caption || '', media.url, media.sourceUrl || ''].join(' ').toLowerCase().includes(query);
      });
    const visibleMedia = filteredMedia.slice(0, mediaVisibleCount);

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <button onClick={() => setEditingProfile(null)} className="text-sm font-bold text-gray-500 hover:text-white">← Back to profiles</button>
            <h2 className="mt-2 text-2xl font-black text-white">{editingProfile.isNew ? 'Create profile' : `Edit ${profile.name || profile.id}`}</h2>
            <p className="text-sm text-gray-500">{editingProfile.origin === 'builtin' ? 'Built-in profile: saves create/update a D1 overlay.' : 'D1 profile: saves are stored in the website CMS database.'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={editingProfile.status} onChange={event => setEditingProfile(current => current ? { ...current, status: event.target.value as CmsProfileStatus } : current)} className="rounded-full border border-white/10 bg-black px-4 py-2.5 text-sm font-bold text-white">
              {Object.entries(profileStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button onClick={() => downloadJson(`${profile.id || 'profile'}.json`, profile)} className={`${buttonCls} border border-white/10 text-gray-300 hover:bg-white/5`}><Download size={16} /> JSON</button>
            <button disabled={profileBusy === 'save'} onClick={() => saveEditingProfile('draft')} className={`${buttonCls} border border-amber-400/30 bg-amber-400/10 text-amber-200`}><Save size={16} /> Draft</button>
            <button disabled={profileBusy === 'save'} onClick={() => saveEditingProfile('published')} className={`${buttonCls} bg-red-600 text-white hover:bg-red-500`}>{profileBusy === 'save' ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Publish</button>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <section className={`${panelCls} space-y-4 p-6`}>
            <h3 className="font-black uppercase tracking-wide text-white">Identity</h3>
            <Field label="Profile ID / URL slug" hint="Becomes /profile/this-id/. Existing IDs should not be renamed.">
              <input disabled={!editingProfile.isNew} value={profile.id} onChange={e => updateEditingProfile(p => ({ ...p, id: slugifyProfileId(e.target.value) }))} className={`${inputCls} disabled:opacity-50`} placeholder="creator-name" />
            </Field>
            <Field label="Display name"><input value={profile.name} onChange={e => updateEditingProfile(p => ({ ...p, name: e.target.value }))} className={inputCls} /></Field>
            <Field label="Handle"><input value={profile.handle} onChange={e => updateEditingProfile(p => ({ ...p, handle: e.target.value }))} className={inputCls} placeholder="@creator" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category"><input value={profile.category} onChange={e => updateEditingProfile(p => ({ ...p, category: e.target.value }))} className={inputCls} /></Field>
              <Field label="Price / month"><input type="number" min="0" step="0.01" value={profile.pricePerMonth || 0} onChange={e => updateEditingProfile(p => ({ ...p, pricePerMonth: Number(e.target.value) }))} className={inputCls} /></Field>
            </div>
            <Field label="Access mode"><input value={profile.access_mode || ''} onChange={e => updateEditingProfile(p => ({ ...p, access_mode: e.target.value }))} className={inputCls} placeholder="cached_preview" /></Field>
            <div className="flex flex-wrap gap-4 text-sm text-gray-300">
              <label className="flex items-center gap-2"><input type="checkbox" checked={profile.isVerified} onChange={e => updateEditingProfile(p => ({ ...p, isVerified: e.target.checked }))} className="h-4 w-4 accent-red-600" /> Verified badge</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={profile.isVisible} onChange={e => updateEditingProfile(p => ({ ...p, isVisible: e.target.checked }))} className="h-4 w-4 accent-red-600" /> Visible flag</label>
            </div>
          </section>

          <section className={`${panelCls} space-y-4 p-6`}>
            <h3 className="font-black uppercase tracking-wide text-white">Avatar & hero</h3>
            <div className="flex items-center gap-4">
              {profile.avatarUrl ? <img src={profile.avatarUrl} alt="Avatar preview" className="h-20 w-20 rounded-2xl object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/5 text-gray-600"><ImageIcon /></div>}
              <div className="min-w-0 flex-1"><p className="truncate font-bold text-white">{profile.name || 'Untitled creator'}</p><p className="truncate text-sm text-gray-500">{profile.handle}</p><p className="text-xs text-gray-600">{profile.images.length} media items</p></div>
            </div>
            <Field label="Avatar URL"><input value={profile.avatarUrl} onChange={e => updateEditingProfile(p => ({ ...p, avatarUrl: e.target.value }))} className={inputCls} /></Field>
            <Field label="Hero/banner URL"><input value={profile.heroUrl} onChange={e => updateEditingProfile(p => ({ ...p, heroUrl: e.target.value }))} className={inputCls} /></Field>
            {profile.heroUrl && <img src={profile.heroUrl} alt="Hero preview" className="h-32 w-full rounded-2xl object-cover" />}
          </section>

          <section className={`${panelCls} space-y-4 p-6`}>
            <div className="flex items-center justify-between"><h3 className="font-black uppercase tracking-wide text-white">Stats</h3><button onClick={() => updateEditingProfile(p => ({ ...p, stats: { ...p.stats, posts: p.images.length } }))} className="text-xs font-black text-red-400 hover:text-red-300">Sync posts</button></div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Posts"><input type="number" min="0" value={profile.stats.posts} onChange={e => updateEditingProfile(p => ({ ...p, stats: { ...p.stats, posts: Number(e.target.value) } }))} className={inputCls} /></Field>
              <Field label="Likes"><input type="number" min="0" value={profile.stats.likes} onChange={e => updateEditingProfile(p => ({ ...p, stats: { ...p.stats, likes: Number(e.target.value) } }))} className={inputCls} /></Field>
              <Field label="Views"><input type="number" min="0" value={profile.stats.views} onChange={e => updateEditingProfile(p => ({ ...p, stats: { ...p.stats, views: Number(e.target.value) } }))} className={inputCls} /></Field>
              <Field label="Followers"><input type="number" min="0" value={profile.stats.followers} onChange={e => updateEditingProfile(p => ({ ...p, stats: { ...p.stats, followers: Number(e.target.value) } }))} className={inputCls} /></Field>
              <Field label="Subscribers"><input type="number" min="0" value={profile.stats.subscribers || 0} onChange={e => updateEditingProfile(p => ({ ...p, stats: { ...p.stats, subscribers: Number(e.target.value) } }))} className={inputCls} /></Field>
            </div>
            <p className="text-xs leading-relaxed text-gray-600">Do not invent engagement numbers for scraped profiles. The scraper only sets posts from media actually found.</p>
          </section>
        </div>

        <section className={`${panelCls} space-y-4 p-6`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-black uppercase tracking-wide text-white">Bio & tags</h3>
            <button onClick={() => updateEditingProfile(p => ({ ...p, bio: `${p.name || 'This creator'} — exclusive previews, photos and videos 🔥 | Subscribe for the full experience ✨` }))} className={`${buttonCls} border border-red-400/30 bg-red-400/10 text-red-200`}><Sparkles size={15} /> Standard bio</button>
          </div>
          <textarea value={profile.bio} maxLength={400} onChange={e => updateEditingProfile(p => ({ ...p, bio: e.target.value }))} className={`${inputCls} min-h-28`} />
          <div className="flex justify-between text-xs text-gray-600"><span>Used on the profile and as descriptive text.</span><span>{profile.bio.length}/400</span></div>
          <Field label="Tags (comma separated, max 12)"><input value={tagText} onChange={e => { setTagText(e.target.value); updateEditingProfile(p => ({ ...p, tags: normalizeTags(e.target.value) })); }} className={inputCls} placeholder="onlyfans, premium, exclusive" /></Field>
        </section>

        <section className={`${panelCls} space-y-5 p-6`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="font-black uppercase tracking-wide text-white">Media manager</h3><p className="text-sm text-gray-500">{filteredMedia.length} matching · {profile.images.length} total</p></div>
            <button onClick={() => updateEditingProfile(p => { const slug = slugifyProfileId(p.id) || 'profile'; p.images = p.images.map((media, index) => ({ ...media, id: `${slug}-${String(index + 1).padStart(3, '0')}` })); return p; })} className={`${buttonCls} border border-white/10 text-gray-300 hover:bg-white/5`}>Regenerate IDs</button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex gap-2"><input value={newMediaUrl} onChange={e => setNewMediaUrl(e.target.value)} className={inputCls} placeholder="Add one image/video URL" /><button onClick={() => addMediaUrls([newMediaUrl])} className={`${buttonCls} shrink-0 bg-red-600 text-white`}><Plus size={16} /> Add</button></div>
            <div className="flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-3 text-gray-600" size={17} /><input value={mediaQuery} onChange={e => setMediaQuery(e.target.value)} className={`${inputCls} pl-10`} placeholder="Filter media…" /></div><select value={mediaTypeFilter} onChange={e => setMediaTypeFilter(e.target.value as typeof mediaTypeFilter)} className="rounded-xl border border-white/10 bg-black px-3 text-sm text-white"><option value="all">All</option><option value="image">Images</option><option value="video">Videos</option></select></div>
          </div>
          <div className="flex gap-2"><textarea value={bulkMediaText} onChange={e => setBulkMediaText(e.target.value)} className={`${inputCls} min-h-24`} placeholder={'Bulk direct media URLs, one per line'} /><button onClick={() => addMediaUrls(bulkMediaText.split(/[\n,]+/))} className={`${buttonCls} shrink-0 self-start border border-white/10 text-gray-200 hover:bg-white/5`}><Upload size={16} /> Import</button></div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleMedia.map(({ media }) => (
              <article key={media.id} className="overflow-hidden rounded-3xl border border-white/10 bg-black/40">
                <MediaPreview media={media} className="aspect-[4/3] w-full" />
                <div className="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-2"><span className="rounded-full bg-white/5 px-2 py-1 font-mono text-[11px] text-gray-400">{media.id}</span><span className="flex items-center gap-1 text-xs font-bold text-gray-400">{media.mediaType === 'video' ? <Video size={14} /> : <ImageIcon size={14} />}{media.mediaType}</span></div>
                  <input value={media.caption || ''} onChange={e => updateMedia(media.id, { caption: e.target.value })} className={inputCls} placeholder="Caption" />
                  <input value={media.url} onChange={e => updateMedia(media.id, { url: e.target.value })} className={`${inputCls} font-mono text-xs`} aria-label="Media URL" />
                  <input value={media.thumbnailUrl} onChange={e => updateMedia(media.id, { thumbnailUrl: e.target.value })} className={`${inputCls} font-mono text-xs`} aria-label="Thumbnail URL" />
                  <div className="grid grid-cols-3 gap-2">
                    <select value={media.mediaType} onChange={e => updateMedia(media.id, { mediaType: e.target.value as Image['mediaType'] })} className="rounded-xl border border-white/10 bg-black px-2 py-2 text-xs text-white"><option value="image">Image</option><option value="video">Video</option></select>
                    <input type="number" value={media.width} onChange={e => updateMedia(media.id, { width: Number(e.target.value) })} className={inputCls} aria-label="Width" />
                    <input type="number" value={media.height} onChange={e => updateMedia(media.id, { height: Number(e.target.value) })} className={inputCls} aria-label="Height" />
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={media.isLocked} onChange={e => updateMedia(media.id, { isLocked: e.target.checked })} className="accent-red-600" /> Locked</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={media.isVisible} onChange={e => updateMedia(media.id, { isVisible: e.target.checked })} className="accent-red-600" /> Visible</label>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => moveMedia(media.id, -1)} className="rounded-full border border-white/10 p-2 text-gray-300 hover:bg-white/5" aria-label="Move up"><ArrowUp size={15} /></button>
                    <button onClick={() => moveMedia(media.id, 1)} className="rounded-full border border-white/10 p-2 text-gray-300 hover:bg-white/5" aria-label="Move down"><ArrowDown size={15} /></button>
                    <button onClick={() => updateEditingProfile(p => { p.images = p.images.filter(item => item.id !== media.id); p.stats = { ...p.stats, posts: p.images.length }; return p; })} className="ml-auto rounded-full bg-rose-500/10 p-2 text-rose-300 hover:bg-rose-500/20" aria-label="Remove media"><Trash2 size={15} /></button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {visibleMedia.length < filteredMedia.length && <button onClick={() => setMediaVisibleCount(current => current + 48)} className={`${buttonCls} mx-auto flex border border-white/10 text-white hover:bg-white/5`}>Load more media</button>}
          {!filteredMedia.length && <p className="py-10 text-center text-sm text-gray-600">No media matches. Add media above or scrape an authorized URL.</p>}
        </section>

        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={() => saveEditingProfile(editingProfile.status)} disabled={profileBusy === 'save'} className={`${buttonCls} border border-white/10 text-white hover:bg-white/5`}><Save size={16} /> Save</button>
          <button onClick={() => saveEditingProfile('published')} disabled={profileBusy === 'save'} className={`${buttonCls} bg-red-600 text-white hover:bg-red-500`}><CheckCircle2 size={16} /> Save & publish</button>
        </div>
      </div>
    );
  };

  const renderProfiles = () => {
    if (editingProfile) return renderProfileEditor();
    return (
      <div className="space-y-6">
        {pendingProfileDelete && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-rose-400/30 bg-rose-950/30 p-5">
            <div><p className="font-black text-rose-100">Delete {pendingProfileDelete.profile.name} from the public website?</p><p className="text-sm text-rose-200/70">This creates a restorable deleted D1 record. It does not rewrite bundled code.</p></div>
            <div className="flex gap-2"><button onClick={() => setPendingProfileDelete(null)} className={`${buttonCls} border border-white/10 text-white`}>Cancel</button><button disabled={profileBusy === pendingProfileDelete.profile.id} onClick={() => saveEntryStatus(pendingProfileDelete, 'deleted')} className={`${buttonCls} bg-rose-600 text-white`}>Yes, delete</button></div>
          </div>
        )}
        {pendingProfileReset && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-amber-400/30 bg-amber-950/30 p-5">
            <div><p className="font-black text-amber-100">{pendingProfileReset.origin === 'builtin' ? 'Remove this D1 overlay?' : 'Permanently delete this D1 profile?'}</p><p className="text-sm text-amber-200/70">{pendingProfileReset.origin === 'builtin' ? 'The bundled built-in version will become public again.' : 'This removes the D1 row and cannot be restored from the panel.'}</p></div>
            <div className="flex gap-2"><button onClick={() => setPendingProfileReset(null)} className={`${buttonCls} border border-white/10 text-white`}>Cancel</button><button disabled={profileBusy === pendingProfileReset.profile.id} onClick={() => resetProfileRecord(pendingProfileReset)} className={`${buttonCls} bg-amber-500 text-black`}>Confirm</button></div>
          </div>
        )}

        <div className={`${panelCls} grid gap-3 p-4 lg:grid-cols-[1fr_auto_auto_auto]`}>
          <div className="relative"><Search className="absolute left-3 top-3 text-gray-600" size={18} /><input value={profileQuery} onChange={e => setProfileQuery(e.target.value)} className={`${inputCls} pl-10`} placeholder="Search name, handle, ID, category, tag…" /></div>
          <select value={profileStatusFilter} onChange={e => setProfileStatusFilter(e.target.value as typeof profileStatusFilter)} className="rounded-xl border border-white/10 bg-black px-3 py-2.5 text-sm text-white"><option value="all">All statuses</option>{Object.entries(profileStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select value={profileOriginFilter} onChange={e => setProfileOriginFilter(e.target.value as typeof profileOriginFilter)} className="rounded-xl border border-white/10 bg-black px-3 py-2.5 text-sm text-white"><option value="all">All sources</option><option value="builtin">Built-in</option><option value="cms">D1 CMS</option></select>
          <button onClick={() => startCreateProfile()} className={`${buttonCls} bg-red-600 text-white hover:bg-red-500`}><Plus size={17} /> New profile</button>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredProfiles.map(entry => (
            <article key={entry.profile.id} className={`${panelCls} overflow-hidden`}>
              <div className="relative h-36 bg-black">
                {entry.profile.heroUrl && <img src={entry.profile.heroUrl} alt="" className="h-full w-full object-cover opacity-70" loading="lazy" />}
                <div className="absolute inset-0 bg-gradient-to-t from-[#101014] via-transparent to-transparent" />
                <div className="absolute left-4 top-4 flex gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase ${profileStatusStyles[entry.status]}`}>{profileStatusLabels[entry.status]}</span>
                  <span className="rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[11px] font-black uppercase text-gray-300">{entry.origin === 'cms' ? 'D1' : 'Built-in'}</span>
                </div>
                {entry.profile.avatarUrl && <img src={entry.profile.avatarUrl} alt="" className="absolute -bottom-7 left-5 h-20 w-20 rounded-3xl border-4 border-[#101014] object-cover" loading="lazy" />}
              </div>
              <div className="p-5 pt-10">
                <h3 className="truncate text-xl font-black text-white">{entry.profile.name}</h3>
                <p className="truncate text-sm text-gray-500">{entry.profile.handle} · <span className="font-mono text-xs">{entry.profile.id}</span></p>
                <div className="mt-3 flex flex-wrap gap-1.5">{entry.profile.tags.slice(0, 5).map(tag => <span key={tag} className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-gray-400">#{tag}</span>)}</div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-gray-500"><span><strong className="block text-base text-white">{entry.profile.images.length}</strong>media</span><span><strong className="block text-base text-white">{numberText(entry.profile.stats.posts)}</strong>posts</span><span><strong className="block text-base text-white">{numberText(entry.profile.stats.followers)}</strong>followers</span></div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button onClick={() => openProfileEditor({ profile: entry.profile, original: entry.original, origin: entry.origin, status: entry.status, isNew: false })} className={`${buttonCls} flex-1 bg-red-600 text-white hover:bg-red-500`}><Edit2 size={15} /> Edit</button>
                  {entry.status === 'published' && <Link to={`/profile/${entry.profile.id}/`} className={`${buttonCls} border border-white/10 text-gray-200 hover:bg-white/5`}><Eye size={15} /> View</Link>}
                  {entry.status !== 'published' && entry.status !== 'deleted' && <button disabled={profileBusy === entry.profile.id} onClick={() => saveEntryStatus(entry, 'published')} className={`${buttonCls} border border-emerald-400/30 bg-emerald-400/10 text-emerald-200`}>Publish</button>}
                  {entry.status === 'published' && <button disabled={profileBusy === entry.profile.id} onClick={() => saveEntryStatus(entry, 'hidden')} className={`${buttonCls} border border-white/10 text-gray-300`}><EyeOff size={15} /> Hide</button>}
                  {entry.status === 'deleted'
                    ? <button disabled={profileBusy === entry.profile.id} onClick={() => saveEntryStatus(entry, 'draft')} className={`${buttonCls} border border-amber-400/30 bg-amber-400/10 text-amber-200`}>Restore draft</button>
                    : <button onClick={() => setPendingProfileDelete(entry)} className="rounded-full bg-rose-500/10 p-2.5 text-rose-300 hover:bg-rose-500/20" aria-label={`Delete ${entry.profile.name}`}><Trash2 size={16} /></button>}
                  {entry.record && <button onClick={() => setPendingProfileReset(entry)} className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-gray-400 hover:bg-white/5">{entry.origin === 'builtin' ? 'Reset overlay' : 'Hard delete'}</button>}
                </div>
              </div>
            </article>
          ))}
        </div>
        {!filteredProfiles.length && <div className={`${panelCls} p-10 text-center text-gray-500`}>No profiles match those filters.</div>}
      </div>
    );
  };

  const renderScraper = () => {
    const scrapedMedia = scrapeResult?.draftProfile.images || [];
    const visibleScrapedMedia = scrapedMedia.slice(0, mediaVisibleCount);
    const selectedCount = selectedScrapeMediaIds.length;

    return (
      <div className="grid gap-6 xl:grid-cols-[430px_1fr]">
        <div className="space-y-6">
          <section className={`${panelCls} space-y-4 p-6`}>
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-red-500/10 p-3 text-red-400"><Wand2 size={22} /></div>
              <div>
                <h2 className="text-xl font-black text-white">URL Scraper</h2>
                <p className="mt-1 text-sm leading-relaxed text-gray-500">Supports public Coomer profile/post URLs, generic webpages, and direct image/video URLs. It never bypasses a login or paywall.</p>
              </div>
            </div>

            <Field label="Primary page or media URL">
              <input value={scrapeUrl} onChange={e => setScrapeUrl(e.target.value)} className={inputCls} placeholder="https://coomer.st/onlyfans/user/creator" />
            </Field>
            <Field label="Extra page / direct media URLs" hint="One URL per line. Direct media is added to the same draft.">
              <textarea value={extraScrapeUrls} onChange={e => setExtraScrapeUrls(e.target.value)} className={`${inputCls} min-h-24`} placeholder={'https://example.com/photo.jpg\nhttps://example.com/video.mp4'} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max media"><input type="number" min="1" max={content?.config.scraperMaxItems || 1000} value={scrapeMaxItems} onChange={e => setScrapeMaxItems(Number(e.target.value))} className={inputCls} /></Field>
              <Field label="Max Coomer pages"><input type="number" min="1" max={content?.config.scraperMaxPages || 10} value={scrapeMaxPages} onChange={e => setScrapeMaxPages(Number(e.target.value))} className={inputCls} /></Field>
            </div>
            <label className="flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm leading-relaxed text-amber-100/80">
              <input type="checkbox" checked={rightsConfirmed} onChange={e => setRightsConfirmed(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-red-600" />
              <span>I confirm that I own this content or have permission from the rights holder/creator to publish the information, images, and videos I import.</span>
            </label>
            <button disabled={scraping || (!scrapeUrl.trim() && !extraScrapeUrls.trim())} onClick={runScrape} className={`${buttonCls} w-full bg-red-600 text-white hover:bg-red-500`}>
              {scraping ? <Loader2 className="animate-spin" size={17} /> : <Wand2 size={17} />} {scraping ? 'Scraping…' : 'Scrape into draft'}
            </button>
          </section>

          <section className={`${panelCls} space-y-4 p-6`}>
            <div className="flex items-center gap-3"><FileJson className="text-red-400" size={22} /><div><h3 className="font-black text-white">Import profile JSON</h3><p className="text-sm text-gray-500">Paste a complete FansLeak Profile JSON or a batch media object.</p></div></div>
            <textarea value={importJsonText} onChange={e => setImportJsonText(e.target.value)} className={`${inputCls} min-h-40 font-mono text-xs`} placeholder='{"id":"creator","name":"Creator","bio":"...","images":[...]}' />
            <label className={`${buttonCls} w-full cursor-pointer border border-white/10 text-gray-200 hover:bg-white/5`}>
              <Upload size={16} /> Load JSON file
              <input type="file" accept="application/json,.json" className="hidden" onChange={async e => { const file = e.target.files?.[0]; if (file) setImportJsonText(await file.text()); }} />
            </label>
            <button disabled={!importJsonText.trim()} onClick={importProfileJson} className={`${buttonCls} w-full border border-red-400/30 bg-red-400/10 text-red-100`}>Open JSON in editor</button>
          </section>
        </div>

        <section className={`${panelCls} min-h-[720px] p-6`}>
          {!scrapeResult ? (
            <div className="flex h-full min-h-[620px] flex-col items-center justify-center text-center text-gray-600">
              <Wand2 size={54} className="mb-4 opacity-30" />
              <h3 className="text-lg font-black uppercase tracking-wide text-gray-400">Waiting for a source URL</h3>
              <p className="mt-2 max-w-lg text-sm leading-relaxed">Scraped information will appear here as a draft using the existing FansLeak profile standard: slug, handle, bio, avatar, hero, category, tags, stats, and locked media previews.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/10 bg-black/40 p-4">
                <div className="flex items-center gap-4">
                  <img src={scrapeResult.draftProfile.avatarUrl} alt="" className="h-16 w-16 rounded-2xl object-cover" />
                  <div>
                    <h3 className="text-xl font-black text-white">{scrapeResult.draftProfile.name}</h3>
                    <p className="text-sm text-gray-500">{scrapeResult.draftProfile.handle} · <span className="font-mono">{scrapeResult.draftProfile.id}</span></p>
                    <p className="mt-1 text-xs uppercase tracking-wide text-red-300">{scrapeResult.sourceType.replaceAll('_', ' ')} · {scrapeResult.pagesFetched} page(s) fetched · {selectedCount}/{scrapedMedia.length} selected</p>
                  </div>
                </div>
                <button onClick={createDraftFromScrape} className={`${buttonCls} bg-red-600 text-white hover:bg-red-500`}><Plus size={16} /> Create draft</button>
              </div>

              {scrapeResult.warnings.length > 0 && (
                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100/80">
                  {scrapeResult.warnings.map(warning => <p key={warning} className="flex gap-2 py-0.5"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{warning}</p>)}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setSelectedScrapeMediaIds(scrapedMedia.map(media => media.id))} className={`${buttonCls} border border-white/10 text-gray-200`}>Select all</button>
                <button onClick={() => setSelectedScrapeMediaIds([])} className={`${buttonCls} border border-white/10 text-gray-200`}>Select none</button>
                <button onClick={() => setSelectedScrapeMediaIds(scrapedMedia.filter(media => media.mediaType === 'image').map(media => media.id))} className={`${buttonCls} border border-white/10 text-gray-200`}><ImageIcon size={15} /> Images</button>
                <button onClick={() => setSelectedScrapeMediaIds(scrapedMedia.filter(media => media.mediaType === 'video').map(media => media.id))} className={`${buttonCls} border border-white/10 text-gray-200`}><Video size={15} /> Videos</button>
                <div className="ml-auto flex min-w-[320px] flex-1 gap-2 sm:max-w-xl">
                  <select value={appendTargetProfileId} onChange={e => setAppendTargetProfileId(e.target.value)} className="min-w-0 flex-1 rounded-full border border-white/10 bg-black px-4 py-2.5 text-sm text-white">
                    <option value="">Append selected to existing profile…</option>
                    {profileEntries.filter(entry => entry.status !== 'deleted').map(entry => <option key={entry.profile.id} value={entry.profile.id}>{entry.profile.name} ({entry.profile.handle})</option>)}
                  </select>
                  <button onClick={appendScrapeToExisting} className={`${buttonCls} border border-red-400/30 bg-red-400/10 text-red-100`}>Append</button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {visibleScrapedMedia.map(media => {
                  const selected = selectedScrapeMediaIds.includes(media.id);
                  return (
                    <button key={media.id} type="button" onClick={() => setSelectedScrapeMediaIds(current => selected ? current.filter(id => id !== media.id) : [...current, media.id])} className={`overflow-hidden rounded-3xl border text-left transition ${selected ? 'border-red-500 ring-2 ring-red-500/30' : 'border-white/10 opacity-60 hover:opacity-90'}`}>
                      <div className="relative">
                        <MediaPreview media={media} className="aspect-square w-full" />
                        <span className={`absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full border ${selected ? 'border-red-400 bg-red-600 text-white' : 'border-white/30 bg-black/60 text-transparent'}`}><CheckCircle2 size={17} /></span>
                        <span className="absolute bottom-3 left-3 rounded-full bg-black/70 px-2 py-1 text-[11px] font-black uppercase text-white">{media.mediaType}</span>
                      </div>
                      <div className="bg-black/50 p-3"><p className="truncate text-xs font-bold text-gray-200">{media.caption || 'Imported media'}</p><p className="truncate font-mono text-[11px] text-gray-600">{media.id}</p></div>
                    </button>
                  );
                })}
              </div>
              {visibleScrapedMedia.length < scrapedMedia.length && <button onClick={() => setMediaVisibleCount(current => current + 48)} className={`${buttonCls} mx-auto flex border border-white/10 text-white`}>Load more scraped media</button>}
            </div>
          )}
        </section>
      </div>
    );
  };

  const renderAdvertEditor = () => {
    if (!editingAdvert) return null;
    const advert = editingAdvert;
    const exists = (content?.adverts || []).some(item => item.id === advert.id);
    const update = (patch: Partial<Advert>) => setEditingAdvert(current => current ? { ...current, ...patch } : current);
    const updateKind = (kind: AdvertKind) => {
      update({
        kind,
        placement: kind === 'popunder' || kind === 'social_bar' ? 'global' : kind === 'managed' && advert.placement === 'global' ? 'home_top' : kind === 'native_banner' && advert.placement === 'global' ? 'home_inline' : advert.placement,
      });
    };
    const setDate = (field: 'startsAt' | 'endsAt', value: string) => {
      setEditingAdvert(current => {
        if (!current) return current;
        const next = { ...current };
        if (value) next[field] = new Date(value).toISOString(); else delete next[field];
        return next;
      });
    };

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><button onClick={() => setEditingAdvert(null)} className="text-sm font-bold text-gray-500 hover:text-white">← Back to adverts</button><h2 className="mt-2 text-2xl font-black text-white">{exists ? `Edit ${advert.title || 'advert'}` : 'Create advert'}</h2></div>
          <button disabled={advertBusy === 'save'} onClick={saveEditingAdvert} className={`${buttonCls} bg-red-600 text-white hover:bg-red-500`}>{advertBusy === 'save' ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Save advert</button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
          <section className={`${panelCls} space-y-4 p-6`}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Advert ID"><input disabled={exists} value={advert.id} onChange={e => update({ id: slugifyProfileId(e.target.value) })} className={`${inputCls} disabled:opacity-50`} /></Field>
              <Field label="Internal title"><input value={advert.title} onChange={e => update({ title: e.target.value })} className={inputCls} /></Field>
              <Field label="Type"><select value={advert.kind} onChange={e => updateKind(e.target.value as AdvertKind)} className={inputCls}>{Object.entries(advertKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
              <Field label="Placement"><select value={advert.placement} onChange={e => update({ placement: e.target.value as AdvertPlacement })} className={inputCls}>{Object.entries(advertPlacementLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
              <Field label="Status"><select value={advert.status} onChange={e => update({ status: e.target.value as AdvertStatus })} className={inputCls}><option value="active">Active</option><option value="draft">Draft</option><option value="disabled">Disabled</option></select></Field>
              <Field label="Priority (lower shows first)"><input type="number" value={advert.priority} onChange={e => update({ priority: Number(e.target.value) })} className={inputCls} /></Field>
              <Field label="Starts at"><input type="datetime-local" value={toDateTimeLocal(advert.startsAt)} onChange={e => setDate('startsAt', e.target.value)} className={inputCls} /></Field>
              <Field label="Ends at"><input type="datetime-local" value={toDateTimeLocal(advert.endsAt)} onChange={e => setDate('endsAt', e.target.value)} className={inputCls} /></Field>
            </div>

            {advert.kind === 'managed' ? (
              <div className="space-y-4 border-t border-white/5 pt-5">
                <Field label="Headline"><input value={advert.headline || ''} onChange={e => update({ headline: e.target.value })} className={inputCls} /></Field>
                <Field label="Description"><textarea value={advert.description || ''} onChange={e => update({ description: e.target.value })} className={`${inputCls} min-h-24`} /></Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Image URL"><input value={advert.imageUrl || ''} onChange={e => update({ imageUrl: e.target.value })} className={inputCls} /></Field>
                  <Field label="Video URL (optional)"><input value={advert.videoUrl || ''} onChange={e => update({ videoUrl: e.target.value })} className={inputCls} /></Field>
                  <Field label="Destination URL"><input value={advert.destinationUrl || ''} onChange={e => update({ destinationUrl: e.target.value })} className={inputCls} /></Field>
                  <Field label="Button label"><input value={advert.ctaLabel || ''} onChange={e => update({ ctaLabel: e.target.value })} className={inputCls} /></Field>
                </div>
              </div>
            ) : (
              <div className="space-y-4 border-t border-white/5 pt-5">
                <div className="flex gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm leading-relaxed text-amber-100/80"><AlertTriangle className="mt-0.5 shrink-0" size={18} /><p>Only paste code from an ad provider you trust. Network scripts run in visitors’ browsers; popunders and social bars can affect trust, speed, and search quality. Scripts that rely on <span className="font-mono">document.write</span> may not work in a React page.</p></div>
                <Field label="Script URL (HTTPS)"><input value={advert.scriptUrl || ''} onChange={e => update({ scriptUrl: e.target.value })} className={`${inputCls} font-mono text-xs`} placeholder="https://provider.example/tag.js" /></Field>
                <Field label={advert.kind === 'html' ? 'Provider HTML' : 'Provider script / tag code'}><textarea value={advert.code || ''} onChange={e => update({ code: e.target.value })} className={`${inputCls} min-h-56 font-mono text-xs`} placeholder="<script ...></script>" /></Field>
              </div>
            )}
          </section>

          <aside className={`${panelCls} h-fit p-6`}>
            <h3 className="font-black uppercase tracking-wide text-white">Preview</h3>
            {advert.kind === 'managed' ? (
              <div className="relative mt-4 min-h-64 overflow-hidden rounded-3xl border border-red-900/50 bg-black">
                {advert.videoUrl ? <video src={advert.videoUrl} poster={advert.imageUrl || undefined} muted loop playsInline className="absolute inset-0 h-full w-full object-cover" /> : advert.imageUrl ? <img src={advert.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                <div className="relative flex min-h-64 flex-col justify-end p-5"><p className="text-[11px] font-black uppercase tracking-[0.18em] text-red-300">Advertisement</p><p className="mt-2 text-2xl font-black text-white">{advert.headline || 'Your headline'}</p><p className="mt-1 text-sm text-white/70">{advert.description || 'Your advert description will appear here.'}</p><span className="mt-4 w-fit rounded-full bg-red-600 px-4 py-2 text-xs font-black uppercase text-white">{advert.ctaLabel || 'Visit sponsor'}</span></div>
              </div>
            ) : (
              <div className="mt-4 rounded-3xl border border-white/10 bg-black/60 p-4">
                <p className="text-sm text-gray-400">Network code is intentionally <strong className="text-white">not executed</strong> inside the admin panel.</p>
                <dl className="mt-4 space-y-2 text-sm"><div className="flex justify-between"><dt className="text-gray-600">Type</dt><dd className="font-bold text-white">{advertKindLabels[advert.kind]}</dd></div><div className="flex justify-between"><dt className="text-gray-600">Placement</dt><dd className="font-bold text-white">{advertPlacementLabels[advert.placement]}</dd></div><div className="flex justify-between"><dt className="text-gray-600">Status</dt><dd className="font-bold text-white">{advert.status}</dd></div></dl>
                {(advert.scriptUrl || advert.code) && <pre className="mt-4 max-h-72 overflow-auto rounded-2xl bg-black p-3 font-mono text-[11px] leading-relaxed text-emerald-300">{advert.scriptUrl || advert.code}</pre>}
              </div>
            )}
          </aside>
        </div>
      </div>
    );
  };

  const renderAdverts = () => {
    if (editingAdvert) return renderAdvertEditor();
    return (
      <div className="space-y-6">
        {pendingAdvertDelete && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-rose-400/30 bg-rose-950/30 p-5">
            <div><p className="font-black text-rose-100">Delete advert “{pendingAdvertDelete.title}”?</p><p className="text-sm text-rose-200/70">This removes it from D1 immediately after confirmation.</p></div>
            <div className="flex gap-2"><button onClick={() => setPendingAdvertDelete(null)} className={`${buttonCls} border border-white/10 text-white`}>Cancel</button><button disabled={advertBusy === pendingAdvertDelete.id} onClick={() => removeAdvert(pendingAdvertDelete)} className={`${buttonCls} bg-rose-600 text-white`}>Delete advert</button></div>
          </div>
        )}
        <div className={`${panelCls} grid gap-3 p-4 lg:grid-cols-[1fr_auto_auto]`}>
          <div className="relative"><Search className="absolute left-3 top-3 text-gray-600" size={18} /><input value={advertQuery} onChange={e => setAdvertQuery(e.target.value)} className={`${inputCls} pl-10`} placeholder="Search adverts…" /></div>
          <select value={advertStatusFilter} onChange={e => setAdvertStatusFilter(e.target.value as typeof advertStatusFilter)} className="rounded-xl border border-white/10 bg-black px-3 py-2.5 text-sm text-white"><option value="all">All statuses</option><option value="active">Active</option><option value="draft">Draft</option><option value="disabled">Disabled</option></select>
          <button onClick={() => setEditingAdvert(emptyAdvert())} className={`${buttonCls} bg-red-600 text-white`}><Plus size={17} /> New advert</button>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredAdverts.map(advert => (
            <article key={advert.id} className={`${panelCls} overflow-hidden`}>
              <div className="relative h-40 bg-black">
                {advert.kind === 'managed' && advert.imageUrl ? <img src={advert.imageUrl} alt="" className="h-full w-full object-cover opacity-80" loading="lazy" /> : <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,#3b0a14,#09090b)] text-red-400"><Megaphone size={42} /></div>}
                <div className="absolute left-4 top-4 flex gap-2"><span className="rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-black uppercase text-white">{advertKindLabels[advert.kind]}</span><span className="rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-black uppercase text-gray-300">{advert.status}</span></div>
              </div>
              <div className="p-5">
                <h3 className="truncate text-lg font-black text-white">{advert.title}</h3>
                <p className="mt-1 text-sm text-gray-500">{advertPlacementLabels[advert.placement]} · priority {advert.priority}</p>
                <p className="mt-2 line-clamp-2 min-h-10 text-sm text-gray-500">{advert.headline || advert.description || (advert.kind === 'managed' ? 'Managed banner' : 'Third-party network slot')}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button onClick={() => setEditingAdvert(clone(advert))} className={`${buttonCls} flex-1 bg-red-600 text-white`}><Edit2 size={15} /> Edit</button>
                  <button onClick={() => setEditingAdvert({ ...clone(advert), id: `${advert.id}-copy-${Date.now().toString(36)}`, title: `${advert.title} copy`, status: 'draft' })} className={`${buttonCls} border border-white/10 text-gray-200`}>Duplicate</button>
                  {advert.status === 'active'
                    ? <button disabled={advertBusy === advert.id} onClick={() => setAdvertStatus(advert, 'disabled')} className={`${buttonCls} border border-white/10 text-gray-300`}><EyeOff size={15} /> Disable</button>
                    : <button disabled={advertBusy === advert.id} onClick={() => setAdvertStatus(advert, 'active')} className={`${buttonCls} border border-emerald-400/30 bg-emerald-400/10 text-emerald-200`}><Eye size={15} /> Activate</button>}
                  <button onClick={() => setPendingAdvertDelete(advert)} className="rounded-full bg-rose-500/10 p-2.5 text-rose-300" aria-label={`Delete ${advert.title}`}><Trash2 size={16} /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
        {!filteredAdverts.length && <div className={`${panelCls} p-10 text-center text-gray-500`}>No adverts yet. Create a managed banner or a trusted network slot.</div>}
      </div>
    );
  };

  const renderSetup = () => {
    const config = content?.config || session?.config;
    const rows = [
      ['SITE_DB', 'D1 binding', 'Required', 'Bind the separate fansleak-site-cms database. This is a Pages binding, not a text variable.'],
      ['ADMIN_USERNAME', 'Secret / encrypted text', 'Required', 'The new website-admin username you choose.'],
      ['ADMIN_PASSWORD', 'Secret', 'Required unless hash used', 'A new strong admin password. Never commit it to GitHub.'],
      ['ADMIN_PASSWORD_SHA256', 'Secret', 'Optional alternative', 'SHA-256 hex of the admin password. Use this instead of ADMIN_PASSWORD if preferred.'],
      ['ADMIN_SESSION_SECRET', 'Secret', 'Required', 'At least 32 random characters. Changing it signs out every admin session.'],
      ['ADMIN_SESSION_HOURS', 'Variable', 'Optional', 'Session length in hours. Default: 8.'],
      ['SCRAPER_MAX_ITEMS', 'Variable', 'Optional', 'Maximum media returned by one scrape. Default: 300, maximum: 1000.'],
      ['SCRAPER_MAX_PAGES', 'Variable', 'Optional', 'Maximum Coomer profile pages per scrape. Default: 3, maximum: 10.'],
      ['SCRAPER_USER_AGENT', 'Variable', 'Optional', 'Custom public-page fetcher user agent.'],
      ['SITE_URL', 'Variable', 'Already used', 'Keep as https://fansleak.pages.dev unless a custom domain replaces it.'],
    ];
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="D1 binding" value={config?.databaseConfigured ? 'Ready' : 'Missing'} detail="Binding name must be SITE_DB" icon={<ShieldCheck size={22} />} />
          <StatCard label="Admin auth" value={config?.authConfigured ? 'Ready' : 'Missing'} detail="Username, password and session secret" icon={<KeyRound size={22} />} />
          <StatCard label="Scraper limits" value={`${config?.scraperMaxItems || 300} / ${config?.scraperMaxPages || 3}`} detail="Media items / Coomer pages" icon={<Wand2 size={22} />} />
        </div>

        <section className={`${panelCls} p-6`}>
          <h2 className="text-xl font-black text-white">Cloudflare Pages setup order</h2>
          <ol className="mt-4 list-decimal space-y-3 pl-6 text-sm leading-relaxed text-gray-400">
            <li>Create a <strong className="text-white">new D1 database</strong> named <span className="font-mono text-red-300">fansleak-site-cms</span>. Do not use or modify the Telegram bot database.</li>
            <li>In the FansLeak Pages project, open <strong className="text-white">Settings → Bindings → D1 database</strong>. Add binding name <span className="font-mono text-red-300">SITE_DB</span> for Production (and Preview if wanted).</li>
            <li>Optionally run <span className="font-mono text-red-300">website-cms/schema.sql</span> in D1 Console. The Pages Functions also create these tables automatically on first use.</li>
            <li>Add the secrets below under <strong className="text-white">Pages → Settings → Environment variables</strong>.</li>
            <li>Retry/redeploy the latest Pages deployment, then sign in here with the new username and password.</li>
          </ol>
          <div className="mt-5 flex flex-wrap gap-2">
            <button onClick={loadContent} className={`${buttonCls} border border-white/10 text-white`}><RefreshCw size={16} /> Refresh status</button>
            <button onClick={downloadBackup} className={`${buttonCls} bg-red-600 text-white`}><Download size={16} /> Export CMS backup</button>
          </div>
        </section>

        <section className={`${panelCls} overflow-hidden`}>
          <div className="border-b border-white/5 p-6"><h3 className="text-lg font-black text-white">Variables and secrets to add</h3><p className="mt-1 text-sm text-gray-500">Values are never shown here or stored in the repository.</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-black/40 text-xs uppercase tracking-wider text-gray-500"><tr><th className="px-5 py-3">Name</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Need</th><th className="px-5 py-3">What to enter</th></tr></thead><tbody>{rows.map(row => <tr key={row[0]} className="border-t border-white/5"><td className="px-5 py-3 font-mono font-bold text-red-300">{row[0]}</td><td className="px-5 py-3 text-gray-300">{row[1]}</td><td className="px-5 py-3 text-gray-300">{row[2]}</td><td className="px-5 py-3 text-gray-500">{row[3]}</td></tr>)}</tbody></table></div>
        </section>

        <section className={`${panelCls} p-6 text-sm leading-relaxed text-gray-400`}>
          <h3 className="text-lg font-black text-white">Forgotten password / reset</h3>
          <p className="mt-2">The old panel had no real password database. To reset access, replace <span className="font-mono text-red-300">ADMIN_PASSWORD</span> in Cloudflare Pages and redeploy. Also replace <span className="font-mono text-red-300">ADMIN_SESSION_SECRET</span> if you want every existing admin browser session signed out immediately.</p>
          <p className="mt-3">Built-in profile edits are stored as D1 overlays; new profiles are stored as complete D1 records. Direct D1 profile URLs, the sitemap, and the website contact catalogue are generated by Pages Functions. No bot files or bot database are used by this CMS.</p>
        </section>
      </div>
    );
  };

  if (!sessionChecked) {
    return <div className="flex min-h-screen items-center justify-center bg-[#070709] text-gray-400"><Loader2 className="mr-3 animate-spin" /> Checking admin session…</div>;
  }

  if (!session?.authenticated) {
    const config = session?.config;
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#070709] px-4 py-10 text-white">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <img src="/logo.svg" alt="FansLeak" className="mx-auto h-14 w-14" />
            <h1 className="mt-4 text-3xl font-black">Website Admin</h1>
            <p className="mt-1 text-sm text-gray-500">Secure server-side login for profiles, scraping and adverts.</p>
          </div>

          {notice && <div className={`mb-4 rounded-2xl border p-4 text-sm ${notice.tone === 'error' ? 'border-rose-400/30 bg-rose-950/30 text-rose-100' : 'border-emerald-400/30 bg-emerald-950/30 text-emerald-100'}`}>{notice.message}</div>}
          {sessionError && <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-950/30 p-4 text-sm text-rose-100">{sessionError}</div>}
          {config && (!config.databaseConfigured || !config.authConfigured) && (
            <div className="mb-4 rounded-2xl border border-amber-400/30 bg-amber-950/30 p-4 text-sm leading-relaxed text-amber-100/85">
              <p className="flex items-center gap-2 font-black text-amber-100"><AlertTriangle size={17} /> Admin setup is incomplete</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {!config.databaseConfigured && <li>Create a separate D1 database and bind it in Pages as <span className="font-mono">SITE_DB</span>.</li>}
                {!config.authConfigured && <li>Add <span className="font-mono">ADMIN_USERNAME</span>, <span className="font-mono">ADMIN_PASSWORD</span>, and a 32+ character <span className="font-mono">ADMIN_SESSION_SECRET</span>.</li>}
              </ul>
            </div>
          )}

          <form onSubmit={submitLogin} className={`${panelCls} space-y-4 p-6`}>
            <Field label="Admin username"><input autoComplete="username" value={usernameInput} onChange={e => setUsernameInput(e.target.value)} className={inputCls} required /></Field>
            <Field label="Admin password"><input type="password" autoComplete="current-password" value={passwordInput} onChange={e => setPasswordInput(e.target.value)} className={inputCls} required /></Field>
            <button disabled={loginBusy} className={`${buttonCls} w-full bg-red-600 text-white hover:bg-red-500`}>{loginBusy ? <Loader2 className="animate-spin" size={17} /> : <Lock size={17} />} Sign in securely</button>
            <p className="text-center text-xs leading-relaxed text-gray-600">Forgot the old login? There was no real old password to recover. Set a new <span className="font-mono">ADMIN_PASSWORD</span> in Cloudflare Pages, redeploy, then sign in here.</p>
          </form>
          <p className="mt-5 text-center text-sm text-gray-600"><Link to="/" className="hover:text-white">← Return to FansLeak</Link></p>
        </div>
      </div>
    );
  }

  const tabs: Array<{ id: AdminTab; label: string; icon: React.ReactNode }> = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={17} /> },
    { id: 'profiles', label: 'Profiles', icon: <Users size={17} /> },
    { id: 'scraper', label: 'URL Scraper', icon: <Wand2 size={17} /> },
    { id: 'adverts', label: 'Adverts', icon: <Megaphone size={17} /> },
    { id: 'setup', label: 'Setup & Secrets', icon: <ShieldCheck size={17} /> },
  ];

  return (
    <div className="min-h-screen bg-[#070709] px-4 py-6 text-white md:px-6">
      <div className="mx-auto max-w-[1500px]">
        <header className={`${panelCls} flex flex-wrap items-center justify-between gap-4 p-5`}>
          <div className="flex items-center gap-4">
            <img src="/logo.svg" alt="FansLeak" className="h-12 w-12" />
            <div><p className="text-[11px] font-black uppercase tracking-[0.22em] text-red-400">FansLeak Control Center</p><h1 className="mt-1 text-2xl font-black">Website Admin Panel</h1><p className="text-sm text-gray-500">Signed in as {session.username} · Bot unchanged</p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/" className={`${buttonCls} border border-white/10 text-gray-200 hover:bg-white/5`}><Eye size={16} /> View website</Link>
            <button onClick={loadContent} className={`${buttonCls} border border-white/10 text-gray-200 hover:bg-white/5`}><RefreshCw size={16} className={contentLoading ? 'animate-spin' : ''} /> Refresh</button>
            <button onClick={submitLogout} className={`${buttonCls} bg-red-600 text-white hover:bg-red-500`}><LogOut size={16} /> Sign out</button>
          </div>
        </header>

        <nav className="mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="Admin sections">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`${buttonCls} shrink-0 ${activeTab === tab.id ? 'bg-red-600 text-white shadow-lg shadow-red-950/40' : 'border border-white/10 bg-white/[0.03] text-gray-400 hover:text-white'}`}>{tab.icon} {tab.label}</button>
          ))}
        </nav>

        {notice && (
          <div className={`mt-5 flex items-start justify-between gap-3 rounded-2xl border p-4 text-sm ${notice.tone === 'error' ? 'border-rose-400/30 bg-rose-950/30 text-rose-100' : notice.tone === 'success' ? 'border-emerald-400/30 bg-emerald-950/30 text-emerald-100' : 'border-sky-400/30 bg-sky-950/30 text-sky-100'}`}>
            <p>{notice.message}</p><button onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={17} /></button>
          </div>
        )}

        <main className="mt-6 pb-10">
          {contentLoading && !content ? (
            <div className={`${panelCls} flex items-center justify-center p-16 text-gray-400`}><Loader2 className="mr-3 animate-spin" /> Loading website CMS…</div>
          ) : !content ? (
            <div className={`${panelCls} p-10 text-center text-gray-400`}>CMS content could not be loaded. Check the Setup tab after refreshing, and confirm the SITE_DB binding.</div>
          ) : activeTab === 'dashboard' ? renderDashboard()
            : activeTab === 'profiles' ? renderProfiles()
            : activeTab === 'scraper' ? renderScraper()
            : activeTab === 'adverts' ? renderAdverts()
            : renderSetup()}
        </main>
      </div>
    </div>
  );
};
