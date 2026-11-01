/**
 * Build the Telegram deep link shared by a profile's Subscribe button and its
 * Videos-tab Get videos button, so both always act on the same profile ID.
 * Dots are encoded as _dot_ because Telegram start parameters cannot contain
 * bare dots in this site's existing bot contract.
 */
export function profileSubscribeUrl(profileId: string, botUsername?: string): string {
  const username = (botUsername?.trim() || 'KasiQueenbot').replace(/^@/, '');
  return `https://t.me/${username}?start=contact_${profileId.replace(/\./g, '_dot_')}`;
}
