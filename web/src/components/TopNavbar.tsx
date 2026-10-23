import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
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
          <NavLink to="/" end>
            홈
          </NavLink>
          <NavLink to="/quarter">분기</NavLink>
          {identity?.logged_in ? (
            <button type="button" onClick={() => void logout()}>
              로그아웃
            </button>
          ) : (
            <button type="button" onClick={login}>
              로그인
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
