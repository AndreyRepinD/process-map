// Экран платформы ПАНЕЛЬЮ РЯДОМ С КАРТОЙ (решение владельца 08.09.2026).
//
// ЗАЧЕМ. Ссылка на экран уводила в новую вкладку, и карта с экраном оказывались
// в разных окнах: чтобы сверить блок с тем, что он считает, приходилось
// переключаться туда-обратно. Панель ставит их рядом — так же, как это устроено
// в самой платформе.
//
// ПОЧЕМУ ВСТРАИВАНИЕ ВООБЩЕ ВОЗМОЖНО. Проверено запросом к фронту In.Plan
// 08.09.2026: ни `X-Frame-Options`, ни `frame-ancestors` в политике нет —
// платформа не запрещает показывать себя во фрейме. Это ФАКТ О СТЕНДЕ, и если
// его когда-нибудь изменят, панель покажет пустое место: браузер блокирует
// такой фрейм молча. Поэтому рядом всегда остаётся переход в новую вкладку —
// он работает независимо от политики.
//
// ЧТО УВИДИТ ЧИТАТЕЛЬ БЕЗ ДОСТУПА — И ПОЧЕМУ ЭТО НЕ ФОРМА ВХОДА. Карта
// публичная, платформа за авторизацией. Без активной сессии фронт уводит фрейм
// на Keycloak, а тот встраивать СЕБЯ ЗАПРЕЩАЕТ: `X-Frame-Options: SAMEORIGIN`,
// `frame-ancestors 'self'` (замерено там же, 08.09.2026). Браузер блокирует
// такой переход молча, и в панели остаётся пустое место. Поэтому подпись внизу
// — не предупреждение, а инструкция: войти в соседней вкладке и обновить.
import { useCallback, useEffect, useRef, useState } from 'react';
import { iconUrl } from '../../assets/icons';
import { config } from '../../config';
import { ru } from '../../i18n/ru';
import { useProcessStore } from '../../store/useProcessStore';
import styles from './ScreenPanel.module.css';

const CLOSE_ICON = iconUrl('x-close');
const LINK_EXTERNAL_ICON = iconUrl('link-external');

/** Доля ширины окна по умолчанию и границы ручного изменения. */
const DEFAULT_RATIO = 0.42;
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.75;

export function ScreenPanel() {
  const screen = useProcessStore((state) => state.embeddedScreen);
  const close = useProcessStore((state) => state.closeEmbedded);
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const dragging = useRef(false);

  // Esc закрывает панель — как и боковую карточку узла. Слушаем на документе:
  // фокус может быть внутри фрейма, и тогда до панели событие не дойдёт вовсе.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [close]);

  const onPointerMove = useCallback((event: PointerEvent): void => {
    if (!dragging.current) {
      return;
    }
    const next = 1 - event.clientX / window.innerWidth;
    setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, next)));
  }, []);

  const stopDrag = useCallback((): void => {
    dragging.current = false;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', stopDrag);
  }, [onPointerMove]);

  useEffect(() => stopDrag, [stopDrag]);

  if (screen === null) {
    return null;
  }

  const startDrag = (): void => {
    dragging.current = true;
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', stopDrag);
  };

  return (
    <aside
      className={styles.panel}
      style={{ width: `${String(Math.round(ratio * 100))}%` }}
      aria-label={ru.screenPanel.ariaLabel}
    >
      {/* Полоса-ручка: тянем границу между картой и экраном. Своя роль
          separator, а не просто div, — иначе для скринридера это пустое место. */}
      <div
        className={styles.grip}
        role="separator"
        aria-orientation="vertical"
        aria-label={ru.screenPanel.resize}
        onPointerDown={startDrag}
      />
      <header className={styles.header}>
        <span className={styles.title} title={screen.title}>
          {screen.title}
        </span>
        <a
          className={styles.action}
          href={screen.url}
          target={config.linkTarget}
          rel="noreferrer"
          title={ru.screenPanel.openInTab}
        >
          <img className={styles.icon} src={LINK_EXTERNAL_ICON} alt="" />
          {ru.screenPanel.openInTab}
        </a>
        <button type="button" className={styles.close} onClick={close} aria-label={ru.drawer.close}>
          <img className={styles.closeIcon} src={CLOSE_ICON} alt="" />
        </button>
      </header>
      {/* key по адресу: смена экрана обязана перезагрузить фрейм, иначе панель
          показывала бы предыдущий, пока пользователь не нажмёт обновление. */}
      <iframe
        key={screen.url}
        className={styles.frame}
        src={screen.url}
        title={screen.title}
        // Фрейм чужого origin: скриптам и формам платформы работать нужно, а
        // доступ к нашему окну — нет. allow-same-origin здесь безопасен именно
        // потому, что origin ДРУГОЙ: он даёт платформе её собственные куки и
        // хранилище, без которых она просто не авторизуется, но не даёт доступа
        // к документу карты.
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
        referrerPolicy="no-referrer"
      />
      <p className={styles.note}>{ru.screenPanel.authNote}</p>
    </aside>
  );
}
