/**
 * Global Messenger Configuration
 */
window.GLOBAL_CONFIG = {
  APP_NAME: "Global Messenger",
  VERSION: "3.5.0",
  // Primary Apps Script Web App Endpoint
  PRIMARY_ENDPOINT: "https://script.google.com/macros/s/AKfycbxeHtIu-WfsOEKZqkyGOmnWIGe362BcNt5_mKq6idGkDxMETYzSMd7wZthu4HEgri26wA/exec",
  // Failover pool for redundancy
  FAILOVER_ENDPOINTS: [
    "https://script.google.com/macros/s/AKfycbxeHtIu-WfsOEKZqkyGOmnWIGe362BcNt5_mKq6idGkDxMETYzSMd7wZthu4HEgri26wA/exec"
  ],
  // Sync interval when tab is active (RAM Cache in Apps Script is ~100-200ms fast)
  SYNC_INTERVAL_MS: 1500,
  // Крупные файлы передаются напрямую в Drive без Base64 и преобразований.
  RESUMABLE_CHUNK_SIZE_BYTES: 8 * 1024 * 1024,
  LEGACY_UPLOAD_LIMIT_BYTES: 25 * 1024 * 1024,
  MAX_FILE_SIZE_BYTES: 1024 * 1024 * 1024 // 1 GB
};

