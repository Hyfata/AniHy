/** 스크롤 잠금 — body position:fixed 방식.
   `overflow: hidden` 단순 잠금은 WebKit/Safari가 window.scrollY를 0으로 리셋해
   배경 페이지가 맨 위로 점프하고 스크롤 복원 메모리가 오염된다(실측 확인).
   fixed + top:-Y 는 시각적 스크롤 위치를 그대로 보존한다.
   중첩 모달 대비 refcount. */
let lockCount = 0;
let lockedY = 0;

export function lockScroll() {
  if (lockCount++ > 0) return;
  lockedY = window.scrollY;
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
  window.scrollTo(0, lockedY);
}

export function isScrollLocked() {
  return lockCount > 0;
}
