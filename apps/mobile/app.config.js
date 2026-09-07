// Keep native config static so release identifiers do not change fingerprints.
module.exports = ({ config }) => {
  const profile = process.env.EAS_BUILD_PROFILE;
  if (process.env.EAS_BUILD === 'true' && (profile === 'preview' || profile === 'production')) {
    if (process.env.EXPO_PUBLIC_API_URL !== 'https://diamond-shine-system-new.vercel.app') {
      throw new Error('Set EXPO_PUBLIC_API_URL in the matching EAS environment to https://diamond-shine-system-new.vercel.app before building.');
    }
  }
  return config;
};
