import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth';
import { dialog } from '../stores/dialog';
import { EditAnimeModal } from './admin/EditAnimeModal';
import { QueueModal } from './admin/QueueModal';
import { ProfileModal } from './ProfileModal';
import { SettingsModal } from './SettingsModal';
import { UserMenu } from './UserMenu';
import { ListIcon } from './icons';
import styles from './TopNavbar.module.css';

export function TopNavbar() {
  const identity = useAuthStore((s) => s.identity);
  const logout = useAuthStore((s) => s.logout);
  const login = useAuthStore((s) => s.login);
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className={styles.navbar}>
      <div className={styles.inner}>
        <Link to="/" className={styles.logo}>
          AniHy
        </Link>
        <nav className={styles.links}>
          {identity?.is_admin && (
            <>
              <button type="button" className={styles.addBtn} onClick={() => setAddOpen(true)}>
                애니 추가
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setQueueOpen(true)}
                title="대기열"
                aria-label="대기열"
              >
                <ListIcon size={20} />
              </button>
            </>
          )}
          <UserMenu
            loggedIn={identity?.logged_in ?? false}
            onProfile={() => setProfileOpen(true)}
            onSettings={() => setSettingsOpen(true)}
            onLogin={login}
            onLogout={() => {
              void (async () => {
                if (!(await dialog.confirm('정말 로그아웃 하시겠습니까?', { confirmLabel: '로그아웃' }))) return;
                await logout();
                // Reset only the logged-in user's query caches without a reload
                // (resetQueries also clears mounted observers like the library
                // bookmark-count badge; removeQueries never notified them)
                queryClient.resetQueries({ queryKey: ['bookmarks'] });
                queryClient.resetQueries({ queryKey: ['users'] });
                queryClient.resetQueries({ queryKey: ['anime'] });
                await dialog.alert('로그아웃되었습니다.');
              })();
            }}
          />
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
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {identity?.is_admin && <QueueModal open={queueOpen} onClose={() => setQueueOpen(false)} />}
    </header>
  );
}
