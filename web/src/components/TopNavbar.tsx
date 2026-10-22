import { Link, NavLink } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import styles from './TopNavbar.module.css';

export function TopNavbar() {
  const identity = useAuthStore((s) => s.identity);
  const logout = useAuthStore((s) => s.logout);
  const login = useAuthStore((s) => s.login);

  return (
    <header className={styles.navbar}>
      <div className={styles.inner}>
        <Link to="/" className={styles.logo}>
          AniHy
        </Link>
        <nav className={styles.links}>
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
    </header>
  );
}
