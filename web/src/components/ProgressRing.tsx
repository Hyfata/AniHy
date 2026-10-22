import styles from './ProgressRing.module.css';

interface ProgressRingProps {
  /** 0~1 */
  progress: number;
  /** 지름 (px) — 기존 .zip-ring 규격 20 */
  size?: number;
}

/** 다운로드 진행률 링 (기존 .zip-ring 대응). */
export function ProgressRing({ progress, size = 20 }: ProgressRingProps) {
  const strokeWidth = 2.5;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(progress, 0), 1);
  return (
    <svg
      className={styles.ring}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="progressbar"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <circle className={styles.bg} cx={size / 2} cy={size / 2} r={r} strokeWidth={strokeWidth} />
      <circle
        className={styles.fg}
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped)}
      />
    </svg>
  );
}
