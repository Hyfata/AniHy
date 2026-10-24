/** 스크롤 잠금 — body position:fixed 방식.
   `overflow: hidden` 단순 잠금은 WebKit/Safari가 window.scrollY를 0으로 리셋해
   배경 페이지가 맨 위로 점프하고 스크롤 복원 메모리가 오염된다(실측 확인).
   fixed + top:-Y 는 시각적 스크롤 위치를 그대로 보존한다.
   중첩 모달 대비 refcount. */
let lockCount = 0;
let lockedY = 0;
/** 잠금 해제 시 lockedY 복원 대신 맨 위로 — 잠금 중 페이지 이동(watch 진입 등) 대응 */
let topOnUnlock = false;

export function requestTopOnUnlock() {
  topOnUnlock = true;
}

export function lockScroll() {
  if (lockCount++ > 0) return;
  lockedY = window.scrollY;
  topOnUnlock = false;
  const b = document.body;
  b.style.position = 'fixed';
  b.style.top = `-${lockedY}px`;
  b.style.left = '0';
  b.style.right = '0';
  b.style.width = '100%';
}

export function unlockScroll() {
  if (lockCount === 0 || --lockCount > 0) return;
  const b = document.body;
  b.style.position = '';
  b.style.top = '';
  b.style.left = '';
  b.style.right = '';
  b.style.width = '';
  window.scrollTo(0, topOnUnlock ? 0 : lockedY);
  topOnUnlock = false;
}

export function isScrollLocked() {
  return lockCount > 0;
}
