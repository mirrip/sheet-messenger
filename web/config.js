/**
 * Global Messenger — Чистая конфигурация
 * Поддержка автономной работы и быстрого подключения бэкенда/БД
 */
window.APP_CONFIG = {
  APP_NAME: "Global Messenger",
  VERSION: "5.2.1",

  // 'local' — работа через локальное хранилище браузера (мгновенно, без задержек и ошибок сети)
  // 'remote' — работа через Google Таблицу / API (включим при подключении БД)
  STORAGE_MODE: "remote",

  // Адрес скрипта/API для удаленного режима (заполним позже)
  API_ENDPOINT: "https://script.google.com/macros/s/AKfycbwcB_ccVYFvgnkIXsIzkJeTuQgVyELeSkLy_R45bF9hlahoHwRGYa4gyzEnEZ5hrGRjLA/exec",

  // Интервал синхронизации (мс)
  POLL_INTERVAL_MS: 4000
};

