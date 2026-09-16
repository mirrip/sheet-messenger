/**
 * Global Messenger — Чистая конфигурация
 * Поддержка автономной работы и быстрого подключения бэкенда/БД
 */
window.APP_CONFIG = {
  APP_NAME: "Global Messenger",
  VERSION: "5.3.0",

  // 'local' — работа через локальное хранилище браузера (мгновенно, без задержек и ошибок сети)
  // 'remote' — работа через Google Таблицу / API (включим при подключении БД)
  STORAGE_MODE: "remote",

  // Адрес скрипта/API для удаленного режима (заполним позже)
  API_ENDPOINT: "https://script.google.com/macros/s/AKfycbwcB_ccVYFvgnkIXsIzkJeTuQgVyELeSkLy_R45bF9hlahoHwRGYa4gyzEnEZ5hrGRjLA/exec",

  // 10 независимых Apps Script-сервисов.
  API_ENDPOINTS: {
    auth: "https://script.google.com/macros/s/AKfycbwcB_ccVYFvgnkIXsIzkJeTuQgVyELeSkLy_R45bF9hlahoHwRGYa4gyzEnEZ5hrGRjLA/exec",
    directory: "https://script.google.com/macros/s/AKfycbzsAvrnnPu5HI0tseXNACVYUUG1NEO4aKc_62BIqn5YFglPv9VHRFfyoyLMiRJdWhOZyA/exec",
    profiles: "https://script.google.com/macros/s/AKfycbysrzs7IVf-5BBQnQKjGWN6zDqPdpH1GkEWeDgz4aoif-9tLwVOp4EqDfKf2-YnW3IgpA/exec",
    conversations: "https://script.google.com/macros/s/AKfycbxhHuiumEgD1L2E6eJPzus563LAGnrQ7iO_btjFozxV1Wnwvv6XhCApnG5094tobIrePA/exec",
    memberships: "https://script.google.com/macros/s/AKfycbyKigj_u8WY_LA_Rh-5yCGalG1ZVo8JoP0NX4xhdXv0OSshlNAP6EcGE8VDZR1NJDe0/exec",
    spaces: "https://script.google.com/macros/s/AKfycbziC44Nr0lSBJuMhH9vwGDB4sZiGKrfg9u1klY1G59t2tPxiiw8Dw49AZhCTrAFYqXQTA/exec",
    messages: "https://script.google.com/macros/s/AKfycbw72UsjL-h8jDca9z1eFAvAe99YrBrK6-Qfpxg-KhmOgm-EUwsAVH9HHn5y24TOsnRO/exec",
    reactions: "https://script.google.com/macros/s/AKfycbwZnrncGeKnU7wn4Pw3_vgv4hY67ZePljMeBtPitxBqy6whujLEmJc3_8ebuqD-NEWv/exec",
    media: "https://script.google.com/macros/s/AKfycbwipdGJfUUkTNc1yLgRHfv_OZQWvdmerIjsvyJye_BpE5b5ZD3_fy7PaM7LPkSvThCh/exec",
    maintenance: "https://script.google.com/macros/s/AKfycbypCPSlIXshtXYEW_lJvWAImcxOihqdne4norWQsxa5fe2FmBhl2Jbw7Nnz-CrCWQGA2A/exec"
  },

  // Интервал синхронизации (мс)
  POLL_INTERVAL_MS: 4000
};

