/**
 * Global Messenger Configuration
 */
window.GLOBAL_CONFIG = {
  APP_NAME: "Global Messenger",
  VERSION: "3.4.2",
  // Primary Apps Script Web App Endpoint
  PRIMARY_ENDPOINT: "https://script.google.com/macros/s/AKfycbx2dr9E2NgBX3BzimfXM_AaEo2wwYr5t8EHymldRoBHSdA62H0y16DTGbsPyd9-6VUdzw/exec",
  // Failover pool for redundancy
  FAILOVER_ENDPOINTS: [
    "https://script.google.com/macros/s/AKfycbx2dr9E2NgBX3BzimfXM_AaEo2wwYr5t8EHymldRoBHSdA62H0y16DTGbsPyd9-6VUdzw/exec"
  ],
  // Sync interval when tab is active (RAM Cache in Apps Script is ~100-200ms fast)
  SYNC_INTERVAL_MS: 1500,
  // Apps Script принимает файл последовательными безопасными частями.
  CHUNK_SIZE_BYTES: 2 * 1024 * 1024,
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024 // 100 MB
};
