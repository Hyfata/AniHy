use tauri::{AppHandle, command, ipc::Channel, Runtime};

use crate::models::*;
use crate::AnihyTabsExt;

#[command]
pub(crate) async fn set_tabs<R: Runtime>(
    app: AppHandle<R>,
    tabs: Vec<TabSpec>,
) -> crate::Result<()> {
    app.anihy_tabs().set_tabs(tabs)
}

#[command]
pub(crate) async fn select_tab<R: Runtime>(app: AppHandle<R>, id: String) -> crate::Result<()> {
    app.anihy_tabs().select_tab(id)
}

#[command]
pub(crate) async fn get_insets<R: Runtime>(app: AppHandle<R>) -> crate::Result<Insets> {
    app.anihy_tabs().get_insets()
}

/// 탭 선택 이벤트 구독. 네이티브 탭바에서 탭이 눌릴 때마다 channel로 TabSelectedEvent가 흐른다.
#[command]
pub(crate) async fn watch_tab_selected<R: Runtime>(
    app: AppHandle<R>,
    channel: Channel<TabSelectedEvent>,
) -> crate::Result<()> {
    app.anihy_tabs().watch_tab_selected(channel)
}

/// safe-area inset 변화 구독. 호출 즉시 현재 값 1회 + 이후 변화분이 channel로 흐른다.
#[command]
pub(crate) async fn watch_insets<R: Runtime>(
    app: AppHandle<R>,
    channel: Channel<Insets>,
) -> crate::Result<()> {
    app.anihy_tabs().watch_insets(channel)
}
