import { Link } from 'react-router-dom';
import styles from './SectionHeader.module.css';

interface SectionHeaderProps {
  title: string;
  /** auxiliary info next to the title (e.g. "N개 작품") */
  meta?: string;
  /** "전체 보기 →" link on the right */
  moreTo?: string;
}

/** Shared home section header — the .section spacing class lives in the same CSS module. */
export function SectionHeader({ title, meta, moreTo }: SectionHeaderProps) {
  return (
    <div className={styles.head}>
      <h2 className={styles.title}>
        {title}
        {meta && <span className={styles.meta}>{meta}</span>}
      </h2>
      {moreTo && (
        <Link to={moreTo} className={styles.more}>
          전체 보기 →
        </Link>
      )}
    </div>
  );
}
