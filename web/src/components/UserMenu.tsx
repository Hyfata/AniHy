import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { tweenFast, useMotionTransition } from '../lib/motion';
import { LoginIcon, LogoutIcon, SettingsIcon, UserIcon } from './icons';
import styles from './UserMenu.module.css';

/** Navbar user menu — logged in: profile/settings/logout, guest: login/settings.
   Same popover pattern as the library MoreMenu. */
export function UserMenu({
  loggedIn,
  onProfile,
  onSettings,
  onLogin,
  onLogout,
}: {
  loggedIn: boolean;
  onProfile: () => void;
  onSettings: () => void;
  onLogin: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const transition = useMotionTransition(tweenFast);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [open]);

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={`${styles.userBtn}${loggedIn ? ` ${styles.userBtnActive}` : ''}`}
        aria-label="사용자 메뉴"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <UserIcon size={20} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className={styles.menu}
            role="menu"
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={transition}
            style={{ transformOrigin: 'top right' }}
          >
            {loggedIn ? (
              <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => {
                  setOpen(false);
                  onProfile();
                }}
              >
                <UserIcon />
                프로필
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => {
                  setOpen(false);
                  onLogin();
                }}
              >
                <LoginIcon />
                로그인
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                setOpen(false);
                onSettings();
              }}
            >
              <SettingsIcon />
              설정
            </button>
            {loggedIn && (
              <button
                type="button"
                role="menuitem"
                className={`${styles.item} ${styles.itemDanger}`}
                onClick={() => {
                  setOpen(false);
                  onLogout();
                }}
              >
                <LogoutIcon />
                로그아웃
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
