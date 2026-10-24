import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth';
import { EditAnimeModal } from './admin/EditAnimeModal';
import styles from './TopNavbar.module.css';

export function TopNavbar() {
  const identity = useAuthStore((s) => s.identity);
  const logout = useAuthStore((s) => s.logout);
  const login = useAuthStore((s) => s.login);
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <header className={styles.navbar}>
      <div className={styles.inner}>
        <Link to="/" className={styles.logo}>
          AniHy
        </Link>
        <nav className={styles.links}>
          {identity?.is_admin && (
            <button type="button" className={styles.addBtn} onClick={() => setAddOpen(true)}>
              애니 추가
            </button>
          )}
          {identity?.logged_in ? (
            <button type="button" onClick={() => void logout()} title="로그아웃" aria-label="로그아웃">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.authIcon}>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          ) : (
            <button type="button" onClick={login} title="로그인" aria-label="로그인">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.authIcon}>
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
            </button>
          )}
        </nav>
      </div>
      {identity?.is_admin && (
        <EditAnimeModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          anime={null}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ['animes'] });
            void queryClient.invalidateQueries({ queryKey: ['quarters'] });
          }}
        />
      )}
    </header>
  );
}
