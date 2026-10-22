import type { CSSProperties } from 'react';
import styles from './Spinner.module.css';

export function Spinner({ centered = false }: { centered?: boolean }) {
  const el = <div className={styles.spinner} role="status" aria-label="로딩 중" />;
  return centered ? <div className={styles.wrap}>{el}</div> : el;
}

export function Skeleton({
  width,
  height,
  style,
  className = '',
}: {
  width?: number | string;
  height?: number | string;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={`${styles.skeleton} ${className}`}
      style={{ width, height, ...style }}
      aria-hidden="true"
    />
  );
}
