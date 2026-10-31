export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN'
}

export interface User {
  id: string;
  email: string;
  role: UserRole;
  favorites: string[]; // Array of Profile IDs
}

export type MediaType = 'image' | 'video';

export interface Image {
  id: string;
  url: string;
  thumbnailUrl: string;
  caption?: string;
  width: number;
  height: number;
  isLocked: boolean; // For members only
  isVisible: boolean; // Soft delete / hide
  mediaType: MediaType;
  // Batch Upload Tracking Fields
  sourceUrl?: string;
  sha256?: string; 
  createdAt?: string;
}

export interface Profile {
  id: string;
  name: string;
  handle: string;
  bio: string;
  avatarUrl: string;
  heroUrl: string;
  tags: string[];
  category: string;
  images: Image[];
  stats: {
    posts: number;
    likes: number;
    views: number;
    followers: number;
    subscribers?: number;
  };
  isVerified: boolean;
  isVisible: boolean; // Public/Hidden
  pricePerMonth?: number; // Optional subscription model
  access_mode?: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
}
export type CmsProfileStatus = 'published' | 'draft' | 'hidden' | 'deleted';
export type CmsProfileOrigin = 'builtin' | 'cms';

export type ProfilePatch = Partial<Omit<Profile, 'id' | 'images'>>;

/**
 * A website-CMS profile record stored in the separate Cloudflare Pages D1
 * database. Built-in profiles are represented as a small overlay instead of
 * copying their complete bundled media arrays into D1 on every edit.
 */
export interface CmsProfileRecord {
  id: string;
  status: CmsProfileStatus;
  origin: CmsProfileOrigin;
  /** Complete profile for CMS-created records. */
  profile?: Profile;
  /** Scalar overlay for a bundled built-in profile. */
  patch?: ProfilePatch;
  addedMedia?: Image[];
  removedMediaIds?: string[];
  mediaPatches?: Record<string, Partial<Omit<Image, 'id'>>>;
  mediaOrder?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export type AdvertStatus = 'active' | 'draft' | 'disabled';
export type AdvertKind =
  | 'managed'
  | 'script'
  | 'html'
  | 'popunder'
  | 'social_bar'
  | 'native_banner';

export type AdvertPlacement =
  | 'global'
  | 'sidebar'
  | 'home_top'
  | 'home_inline'
  | 'home_bottom'
  | 'profile_top'
  | 'profile_inline'
  | 'profile_bottom';

export interface Advert {
  id: string;
  title: string;
  kind: AdvertKind;
  placement: AdvertPlacement;
  status: AdvertStatus;
  priority: number;
  startsAt?: string;
  endsAt?: string;
  headline?: string;
  description?: string;
  imageUrl?: string;
  videoUrl?: string;
  destinationUrl?: string;
  ctaLabel?: string;
  scriptUrl?: string;
  /** Trusted third-party network markup/script, entered only by the site admin. */
  code?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PublicCmsContent {
  profileRecords: CmsProfileRecord[];
  adverts: Advert[];
  generatedAt: string;
}

export interface AdminCmsContent extends PublicCmsContent {
  username: string;
  config: {
    databaseConfigured: boolean;
    authConfigured: boolean;
    scraperMaxItems: number;
    scraperMaxPages: number;
  };
}
