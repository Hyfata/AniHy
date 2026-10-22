import { motion } from 'framer-motion';
import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { springGentle } from '../lib/motion';
import { isNative } from '../lib/native';
import styles from './BottomTabbar.module.css';

interface TabDef {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const TABS: TabDef[] = [
  {
    to: '/',
    label: '홈',
    end: true,
    icon: (
      <svg {...ICON_PROPS}>
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <path d="M9 22V12h6v10" />
      </svg>
    ),
  },
  {
    to: '/quarter',
    label: '분기',
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
    ),
  },
  {
    to: '/search',
    label: '검색',
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    ),
  },
  {
    to: '/library',
    label: '보관함',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

/** 모바일: 하단 sticky 플로팅 pill / 데스크톱: 좌측 사이드바.
   활성 탭 인디케이터는 framer-motion layoutId로 탭 간 슬라이드. */
export function BottomTabbar() {
  // 네이티브(Tauri) 앱에서는 네이티브 탭바가 이 역할을 대신한다
  if (isNative()) return null;
  return (
    <nav className={styles.tabbar} aria-label="하단 탐색">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            `${styles.item}${isActive ? ` ${styles.itemActive}` : ''}`
          }
        >
          {({ isActive }) => (
            <span className={styles.pill}>
              {isActive && (
                <motion.span
                  layoutId="tabbar-pill"
                  className={styles.pillIndicator}
                  transition={springGentle}
                />
              )}
              <span className={styles.pillContent}>
                <span className={styles.icon}>{tab.icon}</span>
                {tab.label}
              </span>
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
