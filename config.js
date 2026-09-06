/**
 * Global Messenger Configuration
 */
window.GLOBAL_CONFIG = {
  APP_NAME: "Global Messenger",
  VERSION: "1.0.0",
  // Primary Apps Script Web App Endpoint
  PRIMARY_ENDPOINT: "https://script.google.com/macros/s/AKfycbwfYYf-kyE0claUI5M80kirXdgBluAm1fChd1yGyAnHvWq-I51Bo83L6W9xh3qKsdXbFg/exec",
  // Failover pool for redundancy
  FAILOVER_ENDPOINTS: [
    "https://script.google.com/macros/s/AKfycbwfYYf-kyE0claUI5M80kirXdgBluAm1fChd1yGyAnHvWq-I51Bo83L6W9xh3qKsdXbFg/exec"
  ],
  // Sync interval when tab is active (RAM Cache in Apps Script is ~100-200ms fast)
  SYNC_INTERVAL_MS: 1500,
  // Max chunk size for file transfers (20 MB chunks for resumable streaming up to 1 TB)
  CHUNK_SIZE_BYTES: 20 * 1024 * 1024,
  MAX_FILE_SIZE_BYTES: 1024 * 1024 * 1024 * 1024 // 1 TB
};
