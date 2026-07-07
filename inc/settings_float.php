<?php if (isAdmin()): ?>
<button type="button" class="fab-settings" onclick="openModal('settings-modal')" title="설정">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h.09A1.65 1.65 0 0 0 9 4.6V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
    </svg>
</button>

<div class="modal-overlay" id="settings-modal">
    <div class="modal modal-sm">
        <div class="modal-header">
            <h2>설정</h2>
            <button class="modal-close" onclick="closeModal('settings-modal')">&times;</button>
        </div>
        <div class="modal-body">
            <div class="settings-list">
                <a href="/anime/admin/access_code.php" class="settings-item">
                    <span class="settings-icon">🔐</span>
                    <span class="settings-label">접근 인증번호 변경</span>
                </a>
                <a href="/anime/admin/logout.php" class="settings-item settings-item-danger">
                    <span class="settings-icon">🚪</span>
                    <span class="settings-label">로그아웃</span>
                </a>
            </div>
        </div>
    </div>
</div>
<?php endif; ?>
