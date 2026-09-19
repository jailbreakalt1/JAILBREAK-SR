'use strict';

const PLATFORMS = {
  PINTEREST: 'PINTEREST',
  TIKTOK: 'TIKTOK',
  FACEBOOK: 'FACEBOOK',
  INSTAGRAM: 'INSTAGRAM',
  UNKNOWN: 'UNKNOWN',
};

const PIN_REGEXES = [
  /^https?:\/\/(?:www\.)?pin(?:terest)?\.(?:com|it|fr|de|es|co\.uk|co\.in)\/pin\//i,
  /^https?:\/\/pin\.it\//i,
];
const TIKTOK_REGEXES = [
  /^https?:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/(?:video|photo)/i,
  /^https?:\/\/(?:www\.)?tiktok\.com\/v\//i,
  /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/(?:@[\w.-]+\/video|v)\/\d+/i,
  /^https?:\/\/(?:vm|vt|m)\.tiktok\.com/i,
];
const FACEBOOK_REGEXES = [
  /^https?:\/\/(?:www\.|m\.)?facebook\.com\//i,
  /^https?:\/\/(?:www\.)?fb\.watch\//i,
  /^https?:\/\/fb\.com\//i,
];
const INSTAGRAM_REGEXES = [
  /^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\//i,
  /^https?:\/\/instagr\.am\/(?:p|reel|tv)\//i,
];

function detect(url) {
  if (typeof url !== 'string' || url.trim() === '') return PLATFORMS.UNKNOWN;

  if (PIN_REGEXES.some((re) => re.test(url))) return PLATFORMS.PINTEREST;
  if (TIKTOK_REGEXES.some((re) => re.test(url))) return PLATFORMS.TIKTOK;
  if (FACEBOOK_REGEXES.some((re) => re.test(url))) return PLATFORMS.FACEBOOK;
  if (INSTAGRAM_REGEXES.some((re) => re.test(url))) return PLATFORMS.INSTAGRAM;

  return PLATFORMS.UNKNOWN;
}

function describe(url) {
  return { platform: detect(url), type: null, title: null };
}

module.exports = { PLATFORMS, detect, describe };
