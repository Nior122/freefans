import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, Hash, ChevronRight, Settings, HelpCircle, FileText, Shield, ArrowRight } from 'lucide-react';
import { useMockData } from '../services/mockData';
import { Profile } from '../types';

const SimpleProfileCard: React.FC<{ profile: Profile }> = ({ profile }) => (
  <Link to={`/profile/${profile.id}/`} className="flex items-center gap-4 p-4 bg-[#0a0a0a] rounded-xl border border-red-900/30 hover:border-red-700/50 hover:bg-[#110000] transition-all">
    <img src={profile.avatarUrl} alt={profile.name} className="w-12 h-12 rounded-full object-cover" />
    <div className="flex-1 min-w-0">
      <h3 className="font-bold text-white truncate">{profile.name}</h3>
      <p className="text-sm text-gray-500 truncate">{profile.handle}</p>
    </div>
    <ChevronRight size={20} className="text-red-700" />
  </Link>
);

export const SearchPage = () => {
  const { profiles } = useMockData();
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    if (!query) return [];
    const lowerQ = query.toLowerCase();
    return profiles.filter(p => 
      p.name.toLowerCase().includes(lowerQ) || 
      p.handle.toLowerCase().includes(lowerQ) ||
      p.bio.toLowerCase().includes(lowerQ)
    );
  }, [profiles, query]);

  return (
    <div className="min-h-screen bg-black max-w-2xl mx-auto px-4 py-6 pb-24">
      <h1 className="text-2xl font-bold mb-6 text-white">Search</h1>
      
      <div className="relative mb-8">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-red-700" size={20} />
        <input 
          autoFocus
          type="text"
          placeholder="Search for creators or posts..."
          className="w-full pl-10 pr-4 py-3 bg-[#0a0a0a] border border-red-900/40 rounded-xl focus:ring-2 focus:ring-red-700 outline-none text-white placeholder-gray-600"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      <div className="space-y-4">
        {query && results.length === 0 && (
          <p className="text-center text-gray-500 py-8">No results found for "{query}"</p>
        )}
        
        {results.map(profile => (
          <SimpleProfileCard key={profile.id} profile={profile} />
        ))}

        {!query && (
          <div className="text-center text-gray-600 py-12">
            <Search size={48} className="mx-auto mb-4 opacity-20 text-red-700" />
            <p>Type to find your favorite creators</p>
          </div>
        )}
      </div>
    </div>
  );
};

export const HashtagsPage = () => {
  const { profiles } = useMockData();
  
  const allTags = useMemo(() => {
    const counts: Record<string, number> = {};
    profiles.forEach(p => {
      p.tags.forEach(t => {
        counts[t] = (counts[t] || 0) + 1;
      });
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [profiles]);

  return (
    <div className="min-h-screen bg-black max-w-2xl mx-auto px-4 py-6 pb-24">
      <h1 className="text-2xl font-bold mb-6 text-white">Trending Hashtags</h1>
      
      <div className="space-y-0 rounded-xl overflow-hidden border border-red-900/30">
        {allTags.map(([tag, count]) => (
          <Link 
            key={tag}
            to={`/?search=${tag}`}
            className="flex items-center justify-between p-4 bg-[#0a0a0a] border-b border-red-900/20 hover:bg-[#110000] transition-colors last:border-0"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-red-900/30 text-red-500 flex items-center justify-center">
                <Hash size={20} />
              </div>
              <div>
                <span className="font-bold text-white block">#{tag}</span>
                <span className="text-xs text-gray-500">{count} {count === 1 ? 'post' : 'posts'}</span>
              </div>
            </div>
            <ArrowRight size={18} className="text-red-800" />
          </Link>
        ))}
      </div>
    </div>
  );
};

export const MorePage = () => {
  const menuItems = [
    { label: 'Help & Support', icon: HelpCircle, path: '/help' },
    { label: 'Terms of Service', icon: FileText, path: '/terms' },
    { label: 'Privacy Policy', icon: Shield, path: '/privacy' },
  ];

  return (
    <div className="min-h-screen bg-black max-w-2xl mx-auto px-4 py-6 pb-24">
      <h1 className="text-2xl font-bold mb-6 text-white">More</h1>
      
      <div className="bg-[#0a0a0a] rounded-xl border border-red-900/30 overflow-hidden">
        {menuItems.map((item, i) => {
          const Icon = item.icon;
          return (
            <button 
              key={item.label}
              className={`w-full flex items-center justify-between p-4 hover:bg-[#110000] transition-colors ${i !== menuItems.length - 1 ? 'border-b border-red-900/20' : ''}`}
            >
              <div className="flex items-center gap-4">
                <Icon size={20} className="text-red-700" />
                <span className="font-medium text-gray-200">{item.label}</span>
              </div>
              <ChevronRight size={18} className="text-red-900" />
            </button>
          );
        })}
      </div>
      
      <div className="mt-8 text-center text-xs text-gray-600">
        <p>FansLeak v1.0.0</p>
        <p>© 2026 FansLeak</p>
      </div>
    </div>
  );
};
