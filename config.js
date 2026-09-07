/**
 * Global Messenger Configuration
 */
window.GLOBAL_CONFIG = {
  APP_NAME: "Global Messenger",
  VERSION: "4.0.0",
  // Primary Apps Script Web App Endpoint
  PRIMARY_ENDPOINT: "https://script.google.com/macros/s/AKfycbxeHtIu-WfsOEKZqkyGOmnWIGe362BcNt5_mKq6idGkDxMETYzSMd7wZthu4HEgri26wA/exec",
  // Failover pool for redundancy
  FAILOVER_ENDPOINTS: [
    "https://script.google.com/macros/s/AKfycbxeHtIu-WfsOEKZqkyGOmnWIGe362BcNt5_mKq6idGkDxMETYzSMd7wZthu4HEgri26wA/exec"
  ],
  // Sync interval when tab is active (RAM Cache in Apps Script is ~100-200ms fast)
  SYNC_INTERVAL_MS: 1500,
  // Текущий безопасный лимит Apps Script. Большие файлы будут вынесены в отдельный транспорт.
  MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024
};

