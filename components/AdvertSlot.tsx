import React, { useEffect, useMemo, useRef } from 'react';
import { ExternalLink, Megaphone } from 'lucide-react';
import { useMockData } from '../services/mockData';
import { isAdvertLive } from '../services/cms';
import type { Advert, AdvertPlacement } from '../types';

const NetworkAdvert = ({ advert }: { advert: Advert }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const injectedRef = useRef(false);
  const injectionKey = `${advert.id}:${advert.updatedAt || ''}:${advert.scriptUrl || ''}:${advert.code?.length || 0}`;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || injectedRef.current) return;
    injectedRef.current = true;
    container.replaceChildren();

    const appendScript = (source: HTMLScriptElement | null, src?: string) => {
      const script = document.createElement('script');
      if (source) {
        for (const attr of Array.from(source.attributes)) script.setAttribute(attr.name, attr.value);
        script.textContent = source.textContent;
      }
      if (src) {
        script.src = src;
        script.async = true;
      }
      container.appendChild(script);
    };

    if (advert.scriptUrl) appendScript(null, advert.scriptUrl);

    if (advert.code) {
      const template = document.createElement('template');
      template.innerHTML = advert.code;
      for (const node of Array.from(template.content.childNodes)) {
        if (node instanceof HTMLScriptElement) appendScript(node);
        else container.appendChild(node.cloneNode(true));
      }
    }

    return () => {
      injectedRef.current = false;
      container.replaceChildren();
    };
  }, [injectionKey]);

  return <div ref={containerRef} data-advert-id={advert.id} data-advert-kind={advert.kind} className="fansleak-network-advert" />;
};

const ManagedAdvert = ({ advert }: { advert: Advert }) => {
  const compact = advert.placement === 'sidebar';
  const content = (
    <>
      {advert.videoUrl ? (
        <video
          src={advert.videoUrl}
          poster={advert.imageUrl || undefined}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : advert.imageUrl ? (
        <img
          src={advert.imageUrl}
          alt={advert.headline || advert.title}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent" />
      <span className="absolute right-3 top-3 rounded-full border border-white/20 bg-black/60 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/80">
        Sponsored
      </span>
      <div className="relative flex h-full flex-col justify-end p-4 text-white">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-red-300">
          <Megaphone size={14} /> Advertisement
        </div>
        {advert.headline && <p className={`${compact ? 'text-base' : 'text-xl'} font-black leading-tight`}>{advert.headline}</p>}
        {advert.description && <p className="mt-1 line-clamp-2 text-sm text-white/75">{advert.description}</p>}
        {advert.destinationUrl && (
          <span className="mt-3 inline-flex w-fit items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-xs font-black uppercase tracking-wide text-white shadow-lg shadow-red-950/40">
            {advert.ctaLabel || 'Visit sponsor'} <ExternalLink size={14} />
          </span>
        )}
      </div>
    </>
  );

  const className = `group relative block overflow-hidden rounded-2xl border border-red-900/50 bg-[#12090b] shadow-xl shadow-black/40 ${compact ? 'min-h-44' : 'min-h-48 md:min-h-56'}`;
  return advert.destinationUrl ? (
    <a href={advert.destinationUrl} target="_blank" rel="nofollow sponsored noopener noreferrer" className={className} aria-label={advert.headline || advert.title}>
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
};

export const AdvertSlot = ({
  placement,
  className = '',
  limit,
}: {
  placement: AdvertPlacement;
  className?: string;
  limit?: number;
}) => {
  const { adverts } = useMockData();
  const visible = useMemo(() => {
    const filtered = adverts
      .filter(advert => advert.placement === placement && isAdvertLive(advert))
      .sort((a, b) => a.priority - b.priority || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return typeof limit === 'number' ? filtered.slice(0, limit) : filtered;
  }, [adverts, placement, limit]);

  if (!visible.length) return null;

  if (placement === 'global') {
    return (
      <div className={className} aria-hidden="true">
        {visible.map(advert => <NetworkAdvert key={advert.id} advert={advert} />)}
      </div>
    );
  }

  return (
    <section aria-label="Advertisements" className={`space-y-4 ${className}`}>
      {visible.map(advert => advert.kind === 'managed'
        ? <ManagedAdvert key={advert.id} advert={advert} />
        : (
          <div key={advert.id} className="overflow-hidden rounded-2xl border border-red-900/40 bg-[#0d0d0f] p-2">
            <p className="px-2 pb-2 pt-1 text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Advertisement</p>
            <NetworkAdvert advert={advert} />
          </div>
        ))}
    </section>
  );
};
