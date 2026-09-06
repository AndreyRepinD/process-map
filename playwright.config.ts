import { defineConfig } from '@playwright/test';

// В CI прогон идёт отдельным job'ом, от которого зависит деплой на Pages
// (.github/workflows/deploy.yml, задача process-map-vjz.3).
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,

  // Локально ретраев нет: флак должен быть виден сразу, а не замазан повтором
  // (именно так месяц жил process-map-6ja). В CI два ретрая — там падение
  // бывает и от нагрузки на раннер, а разбирать его некому в момент прогона.
  retries: isCI ? 2 : 0,

  // Забытый test.only не должен молча сузить прогон в CI до одного теста.
  forbidOnly: isCI,

  // trace: 'on-first-retry' работает только при ненулевых retries — до этой
  // задачи их не было, и при падении в CI не осталось бы вообще никакой
  // диагностики. В CI дополнительно пишется HTML-отчёт: job выгружает его
  // артефактом, потому что текстового лога шага для разбора флака мало.
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    trace: 'on-first-retry',
  },

  // Проект на карту (process-map-3wh.13). Имя проекта — id карты: по нему
  // e2e/maps/expected.ts выбирает, что ожидать на экране.
  //
  // ПОЧЕМУ У MRP ТОЛЬКО СМОУК. Остальные десять спеков — про механику
  // интерфейса и содержат подписи и id узлов SNP дословно. Второй прогон для
  // другой карты не добавил бы сигнала, зато добавил бы времени и новый класс
  // падений. Требования, которые эти спеки молча предъявляют к данным, подняты
  // в tests/mapContract.test.ts и проверяются там для КАЖДОЙ карты.
  projects: [
    { name: 'snp', use: { baseURL: 'http://localhost:5173' } },
    { name: 'mrp', testDir: './e2e/maps', use: { baseURL: 'http://localhost:5174' } },
    { name: 'dp', testDir: './e2e/maps', use: { baseURL: 'http://localhost:5175' } },
    { name: 'meio', testDir: './e2e/maps', use: { baseURL: 'http://localhost:5176' } },
  ],

  // Сервер поднимает сам Playwright, отдельного шага в CI быть НЕ должно:
  // reuseExistingServer в CI равен false, и на занятом порту прогон упадёт
  // с «is already used».
  // Порты карт закреплены только здесь и в скриптах dev:<карта>: в CI
  // reuseExistingServer=false, и занятый порт уронит прогон.
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !isCI,
    },
    {
      command: 'npm run dev:mrp',
      url: 'http://localhost:5174',
      reuseExistingServer: !isCI,
    },
    {
      command: 'npm run dev:dp',
      url: 'http://localhost:5175',
      reuseExistingServer: !isCI,
    },
    {
      command: 'npm run dev:meio',
      url: 'http://localhost:5176',
      reuseExistingServer: !isCI,
    },
  ],
});
