import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, Navigate, useNavigate } from 'react-router-dom';
import {
  Star,
  UploadCloud,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Paperclip,
  ArrowLeft,
  Play,
  Lock,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { useMockData } from '../services/mockData';
import { Lightbox } from './Lightbox';
import { MediaType } from '../types';

export const ProfilePage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profiles, user, toggleFavorite, isFavorite } = useMockData();
  const [activeTab, setActiveTab] = useState<'all' | 'image' | 'video' | 'tags'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Locking State
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());
  const [unlockingIds, setUnlockingIds] = useState<Set<string>>(new Set());
  // Store remaining seconds for specific image IDs
  const [unlockErrors, setUnlockErrors] = useState<Record<string, { spent: number; remaining: number }>>({});

  // Reshuffle State
  const [shuffleToken, setShuffleToken] = useState(0);

  // Live visitor counter
  const [visitorCount, setVisitorCount] = useState(() => Math.floor(Math.random() * 180) + 120);

  // Flaunting button counts (generated once, stable per session)
  const fmtK = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'K' : n.toString();
  const [subCount]  = useState(() => fmtK(Math.floor(Math.random() * 60000) + 18000));
  const [msgCount]  = useState(() => fmtK(Math.floor(Math.random() * 30000) + 8000));
  const [callCount] = useState(() => fmtK(Math.floor(Math.random() * 20000) + 5000));

  // Social proof toast
  const NAMES = [
    'Ashley','Mia','Jordan','Tyler','Brianna','Kayla','Marcus','Destiny','Chris','Aaliyah',
    'Devon','Savannah','Jake','Monique','Ryan','Jasmine','Taylor','Keisha','Logan','Priya',
    'Zoe','Cameron','Alexis','Brandon','Naomi','Hunter','Sierra','Darius','Chloe','Isaiah',
    'Madison','Elijah','Amber','Malik','Tiffany','Kyle','Imani','Nathan','Vanessa','Caleb',
    'Danielle','Derek','Simone','Connor','Aria','Jaden','Leah','Omar','Faith','Austin',
    'Gabrielle','Anthony','Kiera','Xavier','Paige','Damien','Yara','Evan','Nadia','Blake',
    'Tatiana','Jalen','Brooklyn','Miles','Selena','Andre','Camille','Tristan','Jade','Kevin',
    'Ciara','Bryan','Lydia','Terrell','Aisha','Chase','Hailey','Dante','Maya','Preston',
    'Tiana','Dominic','Layla','Micah','Zara','Seth','Nia','Colton','Whitney','Jaylen',
    'Stephanie','Rashad','Elena','Brady','Raven','Vincent','Jocelyn','Shane','Amara','Grant',
  ];
  const ACTIONS: { label: string; icon: string; color: string }[] = [
    { label: 'just subscribed', icon: '💳', color: 'text-red-400' },
    { label: 'just messaged', icon: '💬', color: 'text-blue-400' },
    { label: 'just called', icon: '📞', color: 'text-green-400' },
  ];
  const usedNamesRef = useRef<Set<string>>(new Set());
  const [socialToast, setSocialToast] = useState<{ name: string; label: string; icon: string; color: string } | null>(null);
  const [toastVisible, setToastVisible] = useState(false);

  // Track unlock attempts with cumulative time tracking
  const unlockAttemptRef = useRef<{
    id: string;
    leftAtTime: number | null;  // When user left the page
    cumulativeTimeOutside: number; // Total time spent outside in ms
  } | null>(null);

  const ITEMS_PER_PAGE = 20;
  const REQUIRED_WAIT_MS = 4000; // 4 seconds

  const profile = profiles.find(p => p.id === id);

  if (!profile) return <Navigate to="/" replace />;

  const isFav = isFavorite(profile.id);

  // Mock dates for the specific aesthetic requirements
  const getRandomDate = (index: number) => {
    const date = new Date();
    date.setDate(date.getDate() - index);
    return date.toISOString().split('T')[0];
  };

  const handleFavorite = () => {
    if (!user) {
      alert("Please sign in to add favorites");
      return;
    }
    toggleFavorite(profile.id);
  };

  // Automatic Reshuffle Timer (Every 1 minute)
  useEffect(() => {
    const interval = setInterval(() => {
      setShuffleToken(prev => prev + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Visitor counter fluctuation
  useEffect(() => {
    const interval = setInterval(() => {
      setVisitorCount(prev => {
        const delta = Math.floor(Math.random() * 9) - 4;
        return Math.max(80, Math.min(399, prev + delta));
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Social proof toast cycle — no name repeats until pool exhausted
  useEffect(() => {
    const getUnusedName = () => {
      const unused = NAMES.filter(n => !usedNamesRef.current.has(n));
      if (unused.length === 0) { usedNamesRef.current.clear(); return NAMES[Math.floor(Math.random() * NAMES.length)]; }
      const pick = unused[Math.floor(Math.random() * unused.length)];
      usedNamesRef.current.add(pick);
      return pick;
    };
    const show = () => {
      const name = getUnusedName();
      const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
      setSocialToast({ name, ...action });
      setToastVisible(true);
      setTimeout(() => setToastVisible(false), 2500);
    };
    const scheduleNext = () => {
      const delay = Math.floor(Math.random() * 2000) + 2000;
      return setTimeout(() => { show(); scheduleNext(); }, delay);
    };
    const initial = setTimeout(show, 1500);
    const t = setTimeout(scheduleNext, 4500);
    return () => { clearTimeout(initial); clearTimeout(t); };
  }, []);

  // Cumulative time tracking: Track when user leaves and returns
  useEffect(() => {
    const handlePageLeave = () => {
      const attempt = unlockAttemptRef.current;
      if (!attempt) return;

      // Mark when user left the page
      if (attempt.leftAtTime === null) {
        unlockAttemptRef.current = {
          ...attempt,
          leftAtTime: Date.now()
        };
        console.log(`🚪 User left page - Timer started for media: ${attempt.id}`);
      }
    };

    const handlePageReturn = () => {
      const attempt = unlockAttemptRef.current;
      if (!attempt || attempt.leftAtTime === null) return;

      // Calculate time spent outside during this visit
      const timeSpentOutside = Date.now() - attempt.leftAtTime;
      const newCumulativeTime = attempt.cumulativeTimeOutside + timeSpentOutside;

      console.log(`🔙 User returned to page`);
      console.log(`⏱️  This visit: ${(timeSpentOutside / 1000).toFixed(2)}s`);
      console.log(`📊 Cumulative total: ${(newCumulativeTime / 1000).toFixed(2)}s / 4.00s`);

      // Update cumulative time
      unlockAttemptRef.current = {
        ...attempt,
        leftAtTime: null,
        cumulativeTimeOutside: newCumulativeTime
      };

      const { id } = attempt;

      // Always stop loading spinner on return
      setUnlockingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });

      if (newCumulativeTime >= REQUIRED_WAIT_MS) {
        // Success: Unlock
        console.log(`✅ UNLOCKED! Media ${id} is now accessible`);
        setUnlockedIds(prev => new Set(prev).add(id));
        setUnlockErrors(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        // Reset attempt on success
        unlockAttemptRef.current = null;
      } else {
        // Failure: Show how much time was spent and how much is remaining
        const secondsSpent = Math.floor(newCumulativeTime / 1000);
        const secondsRemaining = Math.ceil((REQUIRED_WAIT_MS - newCumulativeTime) / 1000);
        console.log(`❌ Still locked - Need ${secondsRemaining}s more outside`);
        setUnlockErrors(prev => ({
          ...prev,
          [id]: { spent: secondsSpent, remaining: secondsRemaining }
        }));
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handlePageLeave();
      } else if (document.visibilityState === 'visible') {
        handlePageReturn();
      }
    };

    const handleBlur = () => {
      handlePageLeave();
    };

    const handleFocus = () => {
      handlePageReturn();
    };

    // Event Listeners
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleUnlock = (e: React.MouseEvent, imgId: string) => {
    e.stopPropagation(); // Prevent lightbox opening

    console.log(`🎯 Unlock initiated for media: ${imgId}`);
    console.log(`⏰ Cumulative timer reset to 0s - Waiting for user to leave page...`);

    // Clear previous errors for this ID
    setUnlockErrors(prev => {
      const next = { ...prev };
      delete next[imgId];
      return next;
    });

    // Start unlock process with cumulative tracking
    setUnlockingIds(prev => new Set(prev).add(imgId));
    unlockAttemptRef.current = {
      id: imgId,
      leftAtTime: null,  // Will be set when user leaves
      cumulativeTimeOutside: 0  // Start at 0
    };

    // Open the link - this will trigger the blur/visibility change
    window.open("https://www.effectivecpmnetwork.com/quqay0k2?key=f9dc05c1566e4e3627daf87fe9a2c9fc", "_blank");
  };

  // Memoized shuffled images - updates when shuffleToken changes (every min) or profile changes
  const shuffledImages = useMemo(() => {
    const shuffled = [...profile.images];
    // Simple Fisher-Yates shuffle
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, [profile.images, shuffleToken]);

  // Filtering Logic
  const filteredMedia = useMemo(() => {
    let media = shuffledImages;

    // 1. Tab Filtering
    if (activeTab === 'image') {
      media = media.filter(m => m.mediaType === 'image');
    } else if (activeTab === 'video') {
      media = media.filter(m => m.mediaType === 'video');
    }

    // 2. Search Filtering
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      media = media.filter(m =>
        (m.caption && m.caption.toLowerCase().includes(q))
      );
    }

    return media;
  }, [shuffledImages, activeTab, searchQuery]);

  // Pagination Logic
  const totalImages = filteredMedia.length;
  const totalPages = Math.ceil(totalImages / ITEMS_PER_PAGE);

  // Ensure current page is valid when tab changes
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery]);

  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalImages);
  const displayImages = filteredMedia.slice(startIndex, endIndex);

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      window.scrollTo({ top: 600, behavior: 'smooth' }); // Scroll past header
    }
  };

  // Custom Pagination Button Component
  const PageBtn = ({ children, active = false, disabled = false, onClick }: any) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        min-w-[32px] h-8 px-3 flex items-center justify-center text-sm font-medium border
        transition-colors duration-200
        ${active
          ? 'bg-red-700 border-red-700 text-white'
          : 'bg-[#1a0000] border-red-900/40 text-gray-300 hover:bg-red-900/30 hover:text-white'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      {children}
    </button>
  );

  const PaginationControls = () => (
    <div className="flex gap-1">
      <PageBtn
        disabled={currentPage === 1}
        onClick={() => goToPage(1)}
      >
        <ChevronsLeft size={16} />
      </PageBtn>
      <PageBtn
        disabled={currentPage === 1}
        onClick={() => goToPage(currentPage - 1)}
      >
        <ChevronLeft size={16} />
      </PageBtn>

      {/* Simple Page Indicator */}
      <div className="flex items-center px-2 text-gray-400 text-sm font-mono">
        Page {currentPage} of {totalPages}
      </div>

      <PageBtn
        disabled={currentPage === totalPages || totalPages === 0}
        onClick={() => goToPage(currentPage + 1)}
      >
        <ChevronRight size={16} />
      </PageBtn>
      <PageBtn
        disabled={currentPage === totalPages || totalPages === 0}
        onClick={() => goToPage(totalPages)}
      >
        <ChevronsRight size={16} />
      </PageBtn>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#121212] text-gray-200 font-sans pb-20">

      {/* 1. Header / Banner Section */}
      <div className="relative w-full h-[250px] md:h-[350px] bg-[#1a1a1a] overflow-hidden">
        {/* Banner Image */}
        <div className="absolute inset-0">
          <img
            src={profile.heroUrl}
            alt={`${profile.name} banner`}
            className="w-full h-full object-cover opacity-80"
            fetchPriority="high"
            decoding="async"
            width="1200"
            height="400"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#121212]" />
        </div>

        {/* Back Button */}
        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 z-10 flex items-center justify-center w-10 h-10 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-sm transition-all border border-white/10"
        >
          <ArrowLeft size={20} />
        </button>

        {/* Search Button (Global) */}
        <button
          onClick={() => navigate('/search/')}
          className="absolute top-4 right-4 z-10 flex items-center justify-center w-10 h-10 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-sm transition-all border border-white/10"
        >
          <Search size={20} />
        </button>
      </div>

      {/* Profile Header Content (Centered & Overlapping) */}
      <div className="relative flex flex-col items-center -mt-20 px-4 mb-8">

        {/* Avatar */}
        <div className="relative mb-4">
          <img
            src={profile.avatarUrl}
            alt={`${profile.name} profile picture`}
            width="192"
            height="192"
            className="w-40 h-40 md:w-48 md:h-48 rounded-full border-[6px] border-[#121212] shadow-2xl object-cover bg-[#262626]"
          />
          {/* Online Indicator */}
          <div className="absolute bottom-3 right-3 w-6 h-6 bg-green-500 border-4 border-[#121212] rounded-full"></div>
        </div>

        {/* Info */}
        <div className="text-center space-y-2 mb-6 max-w-2xl">
          <div className="flex items-center justify-center gap-2">
            <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
              {profile.name}
            </h1>
            {profile.isVerified && (
              <svg className="w-6 h-6 text-yellow-400 fill-current" viewBox="0 0 24 24" aria-label="Verified" role="img">
                <path d="M23 12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h11l3 3 7-7h4a2 2 0 0 1 2 2z" />
              </svg>
            )}
          </div>
          <p className="text-gray-400 text-lg font-medium">{profile.handle}</p>
          {profile.bio && (
            <p className="text-gray-300 text-sm md:text-base leading-relaxed pt-2">
              {profile.bio}
            </p>
          )}
          {/* Live visitor counter */}
          <div className="flex items-center justify-center gap-2 pt-1">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600"></span>
            </span>
            <span className="text-sm text-gray-400"><span className="text-white font-semibold">{visitorCount}</span> people viewing now</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4 w-full max-w-sm justify-center mb-3">
          <a href="https://www.fanvue.com/onyxrose" target="_blank" rel="noopener noreferrer" className="animate-wobble flex-1 bg-red-700 hover:bg-red-600 text-white py-2 rounded-full font-bold text-base transition-colors shadow-lg shadow-red-900/40 flex flex-col items-center justify-center gap-0">
            <div className="flex items-center gap-2">
              <UploadCloud size={18} />
              <span>Subscribe</span>
            </div>
            <span className="text-[11px] font-semibold text-red-200 tracking-wide">{subCount} subscribers</span>
          </a>
          <button
            onClick={handleFavorite}
            className={`p-3 rounded-full border transition-all ${isFav
              ? 'bg-[#1a1a1a] border-yellow-500 text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.3)]'
              : 'bg-[#1a1a1a] border-gray-700 hover:border-gray-500 text-white'
              }`}
          >
            <Star size={22} fill={isFav ? "currentColor" : "none"} />
          </button>
        </div>

        {/* Breadcrumb */}
        <nav className="flex justify-center gap-1 text-xs text-gray-500 mb-6">
          <span className="flex items-center gap-1">
            <span className="text-gray-400">Home</span>
            <span>/</span>
          </span>
          <span className="text-gray-300 font-medium">
            {profile.name}
          </span>
        </nav>
        <div className="flex items-center gap-3 w-full max-w-sm justify-center mb-4">
          <a
            href="https://t.me/bp00ty"
            target="_blank"
            rel="noopener noreferrer"
            className="animate-zoom-in flex-1 bg-[#1a1a1a] hover:bg-[#252525] border border-gray-700 hover:border-gray-500 text-white py-2 rounded-full font-bold text-base transition-colors flex flex-col items-center justify-center gap-0"
          >
            <div className="flex items-center gap-2">
              <span>📩</span>
              <span>Message</span>
            </div>
            <span className="text-[11px] font-semibold text-gray-400 tracking-wide">{msgCount} received</span>
          </a>
          <a
            href="https://loadingup.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="animate-shake flex-1 bg-[#1a1a1a] hover:bg-[#252525] border border-gray-700 hover:border-gray-500 text-white py-2 rounded-full font-bold text-base transition-colors flex flex-col items-center justify-center gap-0"
          >
            <div className="flex items-center gap-2">
              <span>📞</span>
              <span>Call Me</span>
            </div>
            <span className="text-[11px] font-semibold text-gray-400 tracking-wide">{callCount} called</span>
          </a>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-2 md:px-4">

        {/* 2. Navigation Tabs */}
        <div className="flex border-b border-red-900/40 mb-4 overflow-x-auto no-scrollbar">
          {[
            { id: 'all', label: `${profile.images.length} Posts` },
            { id: 'image', label: 'Photos' },
            { id: 'video', label: 'Videos' },
            { id: 'tags', label: 'Tags' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`
                px-6 py-4 text-lg font-medium border-b-2 transition-colors whitespace-nowrap
                ${activeTab === tab.id
                  ? 'border-red-600 text-red-500'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-red-900'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 3. Filter Search (Local) */}
        <div className="mb-4">
          <div className="relative">
            <input
              type="text"
              placeholder="Filter posts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#262626] border border-[#333] text-gray-200 p-3 pl-4 pr-12 rounded focus:outline-none focus:border-[#444] placeholder-gray-600"
            />
            <div className="absolute right-0 top-0 h-full px-4 flex items-center justify-center text-gray-500 pointer-events-none">
              <Search size={20} />
            </div>
          </div>
        </div>

        {/* 4. Pagination Info (Top) */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-4 text-sm text-gray-400">
          <div className="mb-2 md:mb-0">
            {totalImages > 0
              ? `Showing ${startIndex + 1} - ${endIndex} of ${totalImages} ${activeTab === 'video' ? 'videos' : 'items'}`
              : 'No content found'
            }
          </div>

          <PaginationControls />
        </div>

        {/* 5. Post Grid */}
        {displayImages.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-1 md:gap-4">
            {displayImages.map((img, idx) => {
              const globalIndex = profile.images.indexOf(img); // Get true index for lightbox
              const isVideo = img.mediaType === 'video';
              // All media requires an explicit unlock, regardless of its stored lock flag.
              const isLocked = !unlockedIds.has(img.id);
              const isUnlocking = unlockingIds.has(img.id);
              const errorSeconds = unlockErrors[img.id];

              return (
                <div
                  key={`${img.id}-${idx}`}
                  onClick={() => {
                    if (isLocked) return;
                    // Open videos in new tab, images in Lightbox
                    if (isVideo) {
                      window.open(img.url, '_blank');
                    } else {
                      setLightboxIndex(globalIndex);
                    }
                  }}
                  className={`
                    relative group aspect-square bg-[#1a1a1a] cursor-pointer overflow-hidden border border-[#262626] 
                    ${isLocked ? 'cursor-default' : 'hover:border-[#444]'}
                    transition-all
                  `}
                >
                  {/* Media Content Container */}
                  <div className={`w-full h-full relative transition-all duration-300 ${isLocked ? 'filter blur-[3px] opacity-95 pointer-events-none' : ''}`}>
                    {isVideo ? (
                      <div className="w-full h-full relative flex items-center justify-center bg-black">
                        <img
                          src={img.thumbnailUrl}
                          alt={img.caption || "Video thumbnail"}
                          className="w-full h-full object-cover opacity-80"
                          loading="lazy"
                          decoding="async"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                          <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/40">
                            <Play fill="white" className="text-white ml-1" size={20} />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <img
                        src={img.thumbnailUrl}
                        alt={img.caption || "Post"}
                        className={`w-full h-full object-cover transition-transform duration-500 ${!isLocked && 'group-hover:scale-105'}`}
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                  </div>

                  {/* Locked Overlay */}
                  {isLocked && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/40 p-4">
                      <div className="mb-3 bg-black/40 p-3 rounded-full border border-white/10 backdrop-blur-sm">
                        <Lock size={32} className="text-white" />
                      </div>

                      <button
                        onClick={(e) => handleUnlock(e, img.id)}
                        disabled={isUnlocking}
                        className={`
                           px-4 py-2 rounded-full font-bold text-sm shadow-lg
                           flex items-center gap-2 transition-all transform hover:scale-105
                           ${isUnlocking
                            ? 'bg-gray-600 text-gray-300 cursor-wait'
                            : 'bg-green-500 hover:bg-green-600 text-white'
                          }
                         `}
                      >
                        {isUnlocking ? (
                          <>
                            <Loader2 size={16} className="animate-spin" />
                            Verifying...
                          </>
                        ) : (
                          "Free Unlock"
                        )}
                      </button>

                      {/* Unlocking Status */}
                      {isUnlocking && (
                        <span className="text-xs text-green-400 mt-2 font-medium animate-pulse">
                          Checking...
                        </span>
                      )}

                      {/* Wait Countdown */}
                      {errorSeconds !== undefined && (
                        <div className="mt-2 flex flex-col gap-1 text-xs text-rose-400 font-bold bg-black/80 px-3 py-2 rounded-lg border border-rose-500/30 text-center max-w-[160px]">
                          <div className="flex items-center gap-1 justify-center">
                            <AlertCircle size={12} className="shrink-0" />
                            <span>Time spent: {errorSeconds.spent}s</span>
                          </div>
                          <span className="text-[11px]">Need {errorSeconds.remaining}s more outside!</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Top Overlay: Caption (Only if unlocked) */}
                  {!isLocked && (
                    <div className="absolute top-0 left-0 right-0 p-3 bg-gradient-to-b from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-gray-100 text-sm md:text-base font-medium line-clamp-2 drop-shadow-md leading-tight">
                        {img.caption || "No description provided..."}
                      </p>
                    </div>
                  )}

                  {/* Bottom Overlay: Metadata (Only if unlocked) */}
                  {!isLocked && (
                    <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex flex-col justify-end min-h-[60px]">
                      <div className="text-xs text-gray-300 font-mono mb-1">
                        {getRandomDate(idx)}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        {isVideo ? (
                          <>
                            <Play size={12} fill="currentColor" />
                            <span>Video</span>
                          </>
                        ) : (
                          <>
                            <Paperclip size={12} />
                            <span>Image</span>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Hover Effect Highlight */}
                  {!isLocked && <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity" />}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-20 text-center text-gray-500">
            {activeTab === 'video' ? 'No videos found.' : 'No items found.'}
          </div>
        )}

        {/* Bottom Pagination */}
        <div className="flex justify-center mt-8 mb-12">
          <PaginationControls />
        </div>

      </div>

      {/* Lightbox Integration */}
      <Lightbox
        images={profile.images}
        selectedIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onChangeIndex={setLightboxIndex}
        unlockedIds={unlockedIds}
      />

      {/* Social Proof Toast */}
      {socialToast && (
        <div
          className={`fixed bottom-6 left-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0f0f0f] border border-red-900/40 shadow-2xl shadow-black/60 transition-all duration-500 max-w-[260px] ${
            toastVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
          }`}
        >
          <span className="text-xl">{socialToast.icon}</span>
          <div className="flex flex-col leading-tight">
            <span className="text-white text-sm font-semibold">{socialToast.name}</span>
            <span className={`text-xs font-medium ${socialToast.color}`}>{socialToast.label}</span>
          </div>
          <span className="ml-auto flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
        </div>
      )}
    </div>
  );
};