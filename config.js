/**
 * Global Messenger Configuration
 */
window.GLOBAL_CONFIG = {
  APP_NAME: "Global Messenger",
  VERSION: "4.0.1",
  // Primary Apps Script Web App Endpoint
  PRIMARY_ENDPOINT: "https://script.google.com/macros/s/AKfycbzQ9zNSB9846dYDGMt3_5OoAiiGmz4SI_UEWbTbuVHh3l91ZRRnN-JnyOR8wF0HNFBDaA/exec",
  // Failover pool for redundancy
  FAILOVER_ENDPOINTS: [
    "https://script.google.com/macros/s/AKfycbzQ9zNSB9846dYDGMt3_5OoAiiGmz4SI_UEWbTbuVHh3l91ZRRnN-JnyOR8wF0HNFBDaA/exec"
  ],
  // Sync interval when tab is active (RAM Cache in Apps Script is ~100-200ms fast)
  SYNC_INTERVAL_MS: 1500,
  // Небольшие файлы идут через Apps Script, крупные — в Drive частями без Base64.
  LEGACY_UPLOAD_LIMIT_BYTES: 25 * 1024 * 1024,
  RESUMABLE_CHUNK_SIZE_BYTES: 8 * 1024 * 1024,
  MAX_FILE_SIZE_BYTES: 1024 * 1024 * 1024
};
