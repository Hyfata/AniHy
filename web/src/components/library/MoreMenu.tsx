import { useEffect, useRef, useState } from 'react';
import { TrashIcon } from '../icons';
import styles from './library.module.css';

/** Small "more" dropdown for the library tabs: 선택 삭제 / 전체 삭제. */
export function MoreMenu({
  onSelectDelete,
  onClearAll,
}: {
  onSelectDelete: () => void;
  onClearAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [open]);

  return (
    <div className={styles.moreWrap} ref={ref}>
      <button
        type="button"
        className={styles.moreBtn}
        aria-label="더보기"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className={styles.moreMenu} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.moreMenuItem}
            onClick={() => {
              setOpen(false);
              onSelectDelete();
            }}
          >
            <TrashIcon />
            선택 삭제
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${styles.moreMenuItem} ${styles.moreMenuItemDanger}`}
            onClick={() => {
              setOpen(false);
              onClearAll();
            }}
          >
            <TrashIcon />
            전체 삭제
          </button>
        </div>
      )}
    </div>
  );
}
