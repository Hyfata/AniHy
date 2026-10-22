import { useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

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
    to: '/library',
    label: '보관함',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
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
];

/** 모바일: 하단 sticky 플로팅 pill / 데스크톱: 좌측 사이드바.
   활성 탭 인디케이터는 단일 요소를 측정 기반(left/top/width/height CSS transition)으로
   이동 — framer layoutId는 스크롤 점프(페이지 이동 시 맨 위로 리셋)와 결합되면
   측정이 어긋나 애니메이션이 지연/누락돼서 폐기. 탭바 내부 offset 기준이라
   페이지 스크롤과 무관하게 항상 정확하다. */
export function BottomTabbar() {
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [indicator, setIndicator] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const activeIndex = TABS.findIndex((t) =>
    t.to === '/' ? location.pathname === '/' : location.pathname.startsWith(t.to),
  );

  // 활성 탭/리사이즈 시 인디케이터 위치를 아이템의 offset으로 측정 (레이아웃 좌표)
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const el = itemRefs.current[activeIndex];
      if (!el || activeIndex < 0) {
        setIndicator(null);
        return;
      }
      setIndicator({
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [activeIndex]);

  // 네이티브(Tauri) 앱에서는 네이티브 탭바가 이 역할을 대신한다
  if (isNative()) return null;

  // 현재 탭 재탭 → 맨 위로 부드럽게 스크롤 (네비게이션 대신)
  const onTabClick = (tab: TabDef) => (e: React.MouseEvent) => {
    const active = tab.to === '/' ? location.pathname === '/' : location.pathname.startsWith(tab.to);
    if (!active) return;
    e.preventDefault();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <nav ref={navRef} className={styles.tabbar} aria-label="하단 탐색">
      {indicator && (
        <span
          className={styles.tabIndicator}
          style={{
            left: indicator.left,
            top: indicator.top,
            width: indicator.width,
            height: indicator.height,
          }}
          aria-hidden="true"
        />
      )}
      {TABS.map((tab, i) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          onClick={onTabClick(tab)}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          className={({ isActive }) =>
            `${styles.item}${isActive ? ` ${styles.itemActive}` : ''}`
          }
        >
          <span className={styles.pill}>
            <span className={styles.pillContent}>
              <span className={styles.icon}>{tab.icon}</span>
              {tab.label}
            </span>
          </span>
        </NavLink>
      ))}
    </nav>
  );
}
