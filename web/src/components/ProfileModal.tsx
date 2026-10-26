import { useQuery } from '@tanstack/react-query';
import { get } from '../api/client';
import { formatDate, formatDurationLong } from '../lib/format';
import { Modal } from './Modal';
import { Skeleton } from './Spinner';
import { UserIcon } from './icons';
import styles from './ProfileModal.module.css';

interface UserProfile {
  display_name: string | null;
  created_at: string | null;
  total_watch_ms: number;
  watched_episodes: number;
  completed_episodes: number;
}

/** Profile modal from the user menu — display name is the login-provisioned
   value (read-only), plus first-use date and watch stats. */
export function ProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => get<UserProfile>('/users/me'),
    enabled: open,
  });

  return (
    <Modal open={open} onClose={onClose} title="프로필" size="sm">
      <div className={styles.head}>
        <div className={styles.avatar}>
          <UserIcon size={28} />
        </div>
        {data ? (
          <div className={styles.name}>{data.display_name ?? '(이름 없음)'}</div>
        ) : (
          <Skeleton height={22} style={{ width: 140 }} />
        )}
      </div>
      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt>첫 이용일</dt>
          <dd>{data ? formatDate(data.created_at) || '-' : <Skeleton height={16} style={{ width: 90 }} />}</dd>
        </div>
        <div className={styles.row}>
          <dt>총 시청시간</dt>
          <dd>{data ? formatDurationLong(data.total_watch_ms) : <Skeleton height={16} style={{ width: 90 }} />}</dd>
        </div>
        <div className={styles.row}>
          <dt>완주한 회차</dt>
          <dd>
            {data ? (
              `${data.completed_episodes}개 (시청 기록 ${data.watched_episodes}개)`
            ) : (
              <Skeleton height={16} style={{ width: 90 }} />
            )}
          </dd>
        </div>
      </dl>
    </Modal>
  );
}
