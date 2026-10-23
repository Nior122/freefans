import React, { useState, useEffect, useRef } from 'react';
import { Lock, Loader2, AlertCircle } from 'lucide-react';
import { Lightbox } from './Lightbox';
import { Image } from '../types';

interface ImageGalleryProps {
  images: Image[];
  userHasAccess: boolean;
}

export const ImageGallery = ({ images, userHasAccess }: ImageGalleryProps) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());
  const [unlockingIds, setUnlockingIds] = useState<Set<string>>(new Set());
  const [unlockErrors, setUnlockErrors] = useState<Record<string, number>>({});

  const unlockAttemptRef = useRef<{ id: string, time: number } | null>(null);
  const REQUIRED_WAIT_MS = 4000;

  // Focus/Visibility listener to check duration
  useEffect(() => {
    const checkUnlock = () => {
      const attempt = unlockAttemptRef.current;
      if (!attempt) return;

      const elapsed = Date.now() - attempt.time;
      const { id } = attempt;

      // Always stop loading spinner on return
      setUnlockingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });

      if (elapsed >= REQUIRED_WAIT_MS) {
        // Success
        setUnlockedIds(prev => new Set(prev).add(id));
        setUnlockErrors(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        // Only reset attempt on success
        unlockAttemptRef.current = null;
      } else {
        // Failure: Show remaining seconds
        const remaining = Math.ceil((REQUIRED_WAIT_MS - elapsed) / 1000);
        setUnlockErrors(prev => ({ ...prev, [id]: remaining }));
        // Don't reset attempt - allow user to try again
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkUnlock();
      }
    };

    window.addEventListener('focus', checkUnlock);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Polling backup
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && unlockAttemptRef.current) {
        checkUnlock();
      }
    }, 500);

    return () => {
      window.removeEventListener('focus', checkUnlock);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, []);

  const handleUnlock = (e: React.MouseEvent, imgId: string) => {
    e.stopPropagation();

    // Clear prev error
    setUnlockErrors(prev => {
      const next = { ...prev };
      delete next[imgId];
      return next;
    });

    // Start
    setUnlockingIds(prev => new Set(prev).add(imgId));
    unlockAttemptRef.current = { id: imgId, time: Date.now() };

    window.open("https://www.effectivecpmnetwork.com/quqay0k2?key=f9dc05c1566e4e3627daf87fe9a2c9fc", "_blank");
  };

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-1 md:gap-4">
        {images.map((img, index) => {
          // Every item starts locked and can only be opened after an explicit unlock.
          const isLocked = !unlockedIds.has(img.id);
          const isUnlocking = unlockingIds.has(img.id);
          const errorSeconds = unlockErrors[img.id];

          return (
            <div
              key={img.id}
              onClick={() => !isLocked && setSelectedIndex(index)}
              className={`
                group relative aspect-[4/5] bg-gray-100 rounded-lg overflow-hidden cursor-pointer
                ${isLocked ? 'cursor-default' : 'hover:opacity-95'}
              `}
            >
              <div className={`w-full h-full transition-all duration-300 ${isLocked ? 'filter blur-md opacity-75 pointer-events-none' : ''}`}>
                <img
                  src={img.thumbnailUrl}
                  alt={img.caption || "Gallery image"}
                  className={`w-full h-full object-cover transition-transform duration-500 ${!isLocked && 'group-hover:scale-105'}`}
                  loading="lazy"
                  decoding="async"
                />
              </div>

              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />

              {/* Locked Overlay */}
              {isLocked && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/40 p-4 text-center">
                  <div className="bg-black/40 p-3 rounded-full mb-3 backdrop-blur-sm border border-white/10">
                    <Lock size={24} className="text-white" />
                  </div>

                  <button
                    onClick={(e) => handleUnlock(e, img.id)}
                    disabled={isUnlocking}
                    className={`
                       px-4 py-2 rounded-full font-bold text-xs shadow-lg mb-1
                       flex items-center gap-2 transition-all transform hover:scale-105
                       ${isUnlocking
                        ? 'bg-gray-600 text-gray-300 cursor-wait'
                        : 'bg-green-500 hover:bg-green-600 text-white'
                      }
                     `}
                  >
                    {isUnlocking ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      "Free Unlock"
                    )}
                  </button>

                  {isUnlocking && (
                    <span className="text-[10px] text-green-400 font-medium animate-pulse">
                      Checking...
                    </span>
                  )}

                  {errorSeconds !== undefined && (
                    <div className="mt-2 flex items-center gap-1 text-[10px] text-rose-400 font-bold bg-black/80 px-2 py-1 rounded border border-rose-500/30 text-center max-w-[120px]">
                      <AlertCircle size={10} className="shrink-0" />
                      <span>Wait {errorSeconds}s more outside.</span>
                    </div>
                  )}
                </div>
              )}

              {/* Caption Overlay on Hover */}
              {!isLocked && img.caption && (
                <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-white text-xs truncate">{img.caption}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Lightbox
        images={images}
        selectedIndex={selectedIndex}
        onClose={() => setSelectedIndex(null)}
        onChangeIndex={setSelectedIndex}
        unlockedIds={unlockedIds}
      />
    </>
  );
};